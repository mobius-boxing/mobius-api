import KnexManager from "../../database/KnexConnection";
import { ICountdownReminderOutcome } from "../../interfaces/countdown/countdown.interfaces";

/** One pending document inside its reminder window, with its computed offset. */
export interface ICountdownDueDocumentRow {
  id: number;
  title: string;
  /** 'YYYY-MM-DD' — the DATE type parser keeps it a string on purpose. */
  dueDate: string;
  /** The document's own threshold, in days. */
  reminderDays: number;
  /** Signed `dueDate - today`: negative once the document is overdue. */
  offsetDays: number;
  uploadedBy: number;
  companyId: number;
}

/** The bits of a `users` row a reminder needs to address an email. */
export interface ICountdownReminderRecipientRow {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  companyId: number;
}

/** Same shape with the display name already assembled. */
export interface ICountdownReminderRecipient {
  id: number;
  email: string;
  name: string;
  isActive: boolean;
  /** Checked against the document's company before the two are paired (L-009). */
  companyId: number;
}

/** One line of a digest, as the per-document history records it. */
export interface ICountdownDigestDocument {
  documentId: number;
  /** Signed `dueDate - sendDate`, negative for an overdue document. */
  offsetDays: number;
}

export interface ICountdownDigestInput {
  userId: number;
  companyId: number;
  /** 'YYYY-MM-DD', the Buenos Aires send day. */
  sendDate: string;
  documents: ICountdownDigestDocument[];
}

export class CountdownReminderDAO {
  /**
   * Every pending document currently inside its own reminder window, across
   * every company that has the module.
   *
   * The window has no lower bound: `dueDate - today <= reminderDays` selects a
   * document from the day it enters its threshold and keeps selecting it every
   * send day afterwards, overdue included, until it stops being pending. The old
   * exact-offset match (`in (7,3,1,0)`) silently dropped any document whose
   * offset day landed on a weekend and went quiet forever once a document was
   * late; this cannot.
   *
   * The module filter mirrors `CompanyModuleDAO.isEnabled` (enabled link + a
   * subscription state that is not canceled/past_due): a company that stopped
   * paying must stop receiving mail, and the scheduler is the one code path that
   * runs without a request — no middleware upstream of it to check that.
   *
   * `today` is bound, never `current_date`: the host sets no session timezone, so
   * the database's day is UTC and would flip three hours before the customer's.
   * One definition of "today" (`todayInBuenosAires`) for the claim and the work.
   *
   * The query stays global across companies — it is the scheduler, there is no
   * request scope to inherit. The tenant check (L-009) is on the pairing, in the
   * service: a recipient is only ever shown documents of their own company.
   */
  async findDue(today: string): Promise<ICountdownDueDocumentRow[]> {
    const knex = KnexManager.getConnection();
    const result = await knex.raw<{ rows: ICountdownDueDocumentRow[] }>(
      `select d.id,
              d.title,
              d."dueDate",
              d."reminderDays",
              (d."dueDate" - ?::date) as "offsetDays",
              d."uploadedBy",
              d."companyId"
         from countdown_documents d
         join company_modules cm
           on cm."companyId" = d."companyId"
          and cm.enabled = true
          and cm."subscriptionStatus" not in ('canceled','past_due')
         join modules m
           on m.id = cm."moduleId"
          and m.slug = 'countdown'
        where d.status = 'pending'
          and (d."dueDate" - ?::date) <= d."reminderDays"
        order by d."dueDate" asc, d.title asc, d.id asc`,
      [today, today],
    );
    return result.rows;
  }

  /**
   * One lookup for every user that might be mailed in this batch. A query per
   * recipient would be hundreds of round trips on a busy morning.
   */
  async findRecipients(
    userIds: number[],
  ): Promise<ICountdownReminderRecipient[]> {
    if (userIds.length === 0) return [];
    const knex = KnexManager.getConnection();
    const rows = await knex<ICountdownReminderRecipientRow>("users")
      .whereIn("id", userIds)
      .select("id", "email", "firstName", "lastName", "isActive", "companyId");
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: [row.firstName, row.lastName].filter(Boolean).join(" ").trim(),
      isActive: row.isActive,
      companyId: row.companyId,
    }));
  }

  /** Who has already had their digest for this send day. */
  async findDigestedUserIds(sendDate: string): Promise<Set<number>> {
    const knex = KnexManager.getConnection();
    const rows = await knex<{ userId: number }>("countdown_reminder_digests")
      .where("sendDate", sendDate)
      .select("userId");
    return new Set(rows.map((row) => row.userId));
  }

  /**
   * Record a delivered digest and the documents it listed, in one transaction
   * and only after the provider accepted the message.
   *
   * The digest row is the idempotency record: `UNIQUE (userId, sendDate)` is what
   * stops a restart mid-batch mailing anybody twice. Both inserts ignore their
   * conflict, so two containers racing on the same recipient cannot make either
   * of them throw — and because `.ignore()` returns no row when it loses that
   * race, the id is re-selected inside the same transaction. Skipping that would
   * leave `digestId` undefined and drop every per-document row in silence.
   */
  async recordDigest(input: ICountdownDigestInput): Promise<void> {
    const knex = KnexManager.getConnection();
    await knex.transaction(async (trx) => {
      const inserted = await trx("countdown_reminder_digests")
        .insert({
          userId: input.userId,
          companyId: input.companyId,
          sendDate: input.sendDate,
          documentCount: input.documents.length,
        })
        .onConflict(["userId", "sendDate"])
        .ignore()
        .returning("id");

      let digestId: number | undefined = inserted[0]?.id;
      if (digestId === undefined) {
        const existing = await trx("countdown_reminder_digests")
          .select("id")
          .where({ userId: input.userId, sendDate: input.sendDate })
          .first();
        digestId = existing?.id;
      }
      if (digestId === undefined) {
        throw new Error("[CountdownReminderDAO] digest row could not be read");
      }

      if (input.documents.length === 0) return;
      await trx("countdown_reminder_log")
        .insert(
          input.documents.map((document) => ({
            documentId: document.documentId,
            userId: input.userId,
            offsetDays: document.offsetDays,
            sentOn: input.sendDate,
            digestId,
          })),
        )
        .onConflict(["documentId", "userId", "sentOn"])
        .ignore();
    });
  }

  /**
   * Claim today for the reminder run, or return undefined if it is already
   * taken. `on conflict do nothing` makes this atomic: two ticks racing — or two
   * containers during a deploy overlap — cannot both win.
   *
   * The day is bound as `?::date` rather than `current_date` for the same reason
   * as the due query: deriving the claim from the database's UTC day while the
   * work uses the Buenos Aires day would let the two disagree around midnight.
   */
  async claimToday(today: string): Promise<number | undefined> {
    const knex = KnexManager.getConnection();
    const result = await knex.raw<{ rows: { id: number }[] }>(
      `insert into countdown_reminder_runs ("runDate") values (?::date)
         on conflict ("runDate") do nothing
         returning id`,
      [today],
    );
    return result.rows[0]?.id;
  }

  /** Stamp the claimed run with what actually happened. */
  async recordOutcome(
    id: number,
    outcome: ICountdownReminderOutcome,
  ): Promise<void> {
    const knex = KnexManager.getConnection();
    await knex("countdown_reminder_runs")
      .where({ id })
      .update({ ...outcome, updatedAt: knex.fn.now() });
  }
}
