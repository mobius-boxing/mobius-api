import { CountdownAssignmentDAO } from "../../dao/countdown/countdown-assignment.dao";
import {
  CountdownReminderDAO,
  ICountdownDueDocumentRow,
} from "../../dao/countdown/countdown-reminder.dao";
import { ICountdownReminderOutcome } from "../../interfaces/countdown/countdown.interfaces";
import {
  baLocalHour,
  baLocalWeekday,
  calendarDaysBetween,
  todayInBuenosAires,
} from "../../utils/buenosAiresDay";
import { sendModuleEmail } from "../module-email.service";

/** One batch a day, at 08:00 Buenos Aires, Monday to Friday. */
export const SEND_HOUR = 8;

/**
 * The whole schedule in one predicate, exported so it can be tested without
 * waiting for a Tuesday: weekdays only, from 08:00 Buenos Aires.
 *
 * Nothing goes out on Saturday or Sunday. A reminder whose offset day lands on
 * a weekend is therefore never sent — it is not deferred to Monday, because by
 * Monday the offset has moved and no longer matches. Deliberate: the owner
 * asked for one job, no catch-up, no retries.
 */
export function shouldRunAt(now: Date): boolean {
  const weekday = baLocalWeekday(now);
  if (weekday === 0 || weekday === 6) return false;
  return baLocalHour(now) >= SEND_HOUR;
}

/** One document as the digest needs it. No ids: the builder never touches the DB. */
export interface ICountdownDigestRow {
  title: string;
  /** 'YYYY-MM-DD' */
  dueDate: string;
}

/**
 * The window, as one statement: a document is in scope from `reminderDays`
 * before its due date, and stays in scope for as long as it is pending — there
 * is no lower bound, so an overdue document is reported every send day until
 * somebody resolves it.
 */
export function isInReminderWindow(
  offsetDays: number,
  reminderDays: number,
): boolean {
  return offsetDays <= reminderDays;
}

/** dueDate first, title as the tiebreak — one comparator, used on both sections. */
function byDueDateThenTitle(
  a: ICountdownDigestRow,
  b: ICountdownDigestRow,
): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.title.localeCompare(b.title, "es");
}

function upcomingLine(row: ICountdownDigestRow, offsetDays: number): string {
  if (offsetDays === 0) return `- ${row.title} — vence hoy`;
  if (offsetDays === 1) return `- ${row.title} — vence mañana`;
  return `- ${row.title} — vence en ${offsetDays} días`;
}

function overdueLine(row: ICountdownDigestRow, offsetDays: number): string {
  const late = -offsetDays;
  return late === 1
    ? `- ${row.title} — vencido hace 1 día`
    : `- ${row.title} — vencido hace ${late} días`;
}

/**
 * One recipient's digest for one send day: subject and plain-text body.
 *
 * Pure by design — no database, no provider, no clock — because
 * `sendModuleEmail` deliberately never logs a body, so a unit test asserting
 * this text is the only place the wording can be verified at all.
 *
 * Overdue documents come first: they are the more urgent, and a recipient whose
 * documents are all overdue still gets mail. A section with nothing in it is
 * omitted entirely, heading included.
 *
 * `rows` is never empty — `run()` does not call this for a recipient with
 * nothing in scope — so no empty-digest defence is written here.
 *
 * The link back to the module stays optional: unset until the hosting cutover,
 * and omitted rather than pointing at the standalone app, because sending Mobius
 * users to a system where they have no account is worse than no link at all.
 */
export function buildDigest(
  recipientName: string,
  rows: ICountdownDigestRow[],
  today: string,
): { subject: string; body: string } {
  const withOffset = rows.map((row) => ({
    row,
    offsetDays: calendarDaysBetween(today, row.dueDate),
  }));

  const overdue = withOffset
    .filter((entry) => entry.offsetDays < 0)
    .sort((a, b) => byDueDateThenTitle(a.row, b.row));
  const upcoming = withOffset
    .filter((entry) => entry.offsetDays >= 0)
    .sort((a, b) => byDueDateThenTitle(a.row, b.row));

  const total = overdue.length + upcoming.length;
  const subject =
    overdue.length === 0
      ? `Documentos próximos a vencer (${total})`
      : `Documentos vencidos y próximos a vencer (${total})`;

  const lines = [`Hola ${recipientName},`];
  if (overdue.length > 0) {
    lines.push(
      "",
      "Vencidos",
      ...overdue.map((entry) => overdueLine(entry.row, entry.offsetDays)),
    );
  }
  if (upcoming.length > 0) {
    lines.push(
      "",
      "Próximos a vencer",
      ...upcoming.map((entry) => upcomingLine(entry.row, entry.offsetDays)),
    );
  }
  const appUrl = process.env.COUNTDOWN_APP_URL;
  if (appUrl) lines.push("", "Verlo en Countdown:", appUrl);

  return { subject, body: lines.join("\n") };
}

export class CountdownRemindersService {
  private _reminderDAO: CountdownReminderDAO = new CountdownReminderDAO();
  private _assignmentDAO: CountdownAssignmentDAO = new CountdownAssignmentDAO();

  /**
   * Send today's digests, for every company with the module enabled: one email
   * per recipient, listing every document of theirs currently inside its own
   * reminder window.
   *
   * Who a document's recipients are, stated once: the effective watchers if it
   * has any, and otherwise **every active non-`superAdmin` user of the
   * document's own company**. An expiration nobody was assigned to used to warn
   * exactly one person — whoever filed it — so one holiday was enough for it to
   * reach nobody who could act on it. The uploader is still warned, by virtue of
   * being an active user of that company and not by a branch of their own; a
   * company whose only active user is a `superAdmin` produces no mail, which is
   * the accepted degenerate case (D-5).
   *
   * One closure serves both loops below, so the candidate lookup and the pairing
   * can never disagree about who the recipients are.
   *
   * Safe to call repeatedly. `countdown_reminder_digests` carries
   * `UNIQUE (userId, sendDate)` and a recipient already recorded for today is
   * skipped, so a container restart in the middle of a run cannot mail anybody
   * twice.
   *
   * Crash rule: nothing is recorded until the provider has accepted the message,
   * so a crash in between leaves no trace and the same digest can be rebuilt
   * later the same day. Re-delivery is prevented at the provider by the
   * `Idempotency-Key` (honoured 24 h) and, in practice, by the daily claim in
   * `countdown_reminder_runs`. A digest the provider rejects is NOT recorded and
   * NOT retried today — that is precisely the fix that ended sixteen delivery
   * attempts a day against one permanently undeliverable address; the next
   * weekday's batch is the retry.
   *
   * The outcome counts digests, not documents: `sent` = accepted digests,
   * `failed` = rejected digests **plus** digests whose recording threw after the
   * provider accepted them (the recipient loop catches per recipient so one
   * failure cannot cancel the rest of the batch — mail went out, the bookkeeping
   * did not), `skipped` = recipients dropped (inactive, cross-tenant, or already
   * digested today), counted once per recipient however many documents they lost.
   */
  async run(now: Date = new Date()): Promise<ICountdownReminderOutcome> {
    const result: ICountdownReminderOutcome = {
      sent: 0,
      failed: 0,
      skipped: 0,
    };

    const today = todayInBuenosAires(now);
    const due = await this._reminderDAO.findDue(today);
    if (due.length === 0) return result;

    const documentIds = due.map((row) => row.id);
    const [watchers, digested] = await Promise.all([
      this._assignmentDAO.effectiveUserIds(documentIds, "watcher"),
      this._reminderDAO.findDigestedUserIds(today),
    ]);

    // Only the companies that actually need a fallback, and only once each: a
    // batch where every due document has watchers asks nothing of the database
    // at all, and five unassigned documents of one company ask exactly once.
    const fallbackCompanyIds = new Set<number>();
    for (const row of due) {
      const set = watchers.get(row.id);
      if (!set || set.size === 0) fallbackCompanyIds.add(row.companyId);
    }
    const companyUsers = fallbackCompanyIds.size
      ? await this._reminderDAO.findCompanyRecipientIds([...fallbackCompanyIds])
      : new Map<number, number[]>();

    /** The recipient rule, in one place, for both loops below. */
    const recipientIdsFor = (row: ICountdownDueDocumentRow): number[] => {
      const set = watchers.get(row.id);
      if (set && set.size > 0) return [...set];
      // Nobody named: the document's whole company is warned, uploader included.
      return companyUsers.get(row.companyId) ?? [];
    };

    // One lookup for every user that might be written to.
    const candidateIds = new Set<number>();
    for (const row of due) {
      for (const id of recipientIdsFor(row)) candidateIds.add(id);
    }
    const recipients = new Map(
      (await this._reminderDAO.findRecipients([...candidateIds])).map(
        (recipient) => [recipient.id, recipient],
      ),
    );

    // Pairing: documents grouped per recipient, in the SQL's order, so the
    // digest and its log rows are reproducible.
    const byRecipient = new Map<number, ICountdownDueDocumentRow[]>();
    // People, not pairings: `skipped` is a count of recipients (AC-38) and is
    // persisted to countdown_reminder_runs, where it is the signal for whether
    // the tenant rule stopped somebody's mail. One bookkeeper watching twelve
    // documents must read as 1, not as 12 — otherwise it cannot be told apart
    // from twelve deactivated accounts.
    const dropped = new Set<number>();
    for (const row of due) {
      for (const userId of recipientIdsFor(row)) {
        const recipient = recipients.get(userId);
        // A watcher assignment — or a company lookup — pointing at a user of
        // another company is dropped here, never mailed: the scheduler has no
        // request scope to inherit, so this is the module's tenant boundary
        // (L-009), and it stays as the second belt now that the fallback set is
        // company-wide.
        if (!recipient || recipient.companyId !== row.companyId) {
          dropped.add(userId);
          continue;
        }
        // Belt to the SQL's braces, and the statement the window matrix drives.
        if (!isInReminderWindow(row.offsetDays, row.reminderDays)) continue;

        const rows = byRecipient.get(userId) ?? [];
        rows.push(row);
        byRecipient.set(userId, rows);
      }
    }

    // Somebody who lost one document to the tenant rule but still receives a
    // digest for their own was not skipped — they are counted by the loop below.
    for (const userId of byRecipient.keys()) dropped.delete(userId);
    result.skipped += dropped.size;

    for (const [userId, rows] of byRecipient) {
      // One recipient's problem is that recipient's problem: a throw here used
      // to escape run(), and because runDailyOnce has already claimed the day by
      // then, everybody after the failure got nothing until the next weekday.
      try {
        const recipient = recipients.get(userId);
        // Mobius owns identity: a deactivated user is `isActive = false` here,
        // where the standalone app had its own per-user status column.
        if (!recipient || !recipient.isActive) {
          result.skipped += 1;
          continue;
        }
        if (digested.has(userId)) {
          result.skipped += 1;
          continue;
        }

        const { subject, body } = buildDigest(
          recipient.name,
          rows.map(({ title, dueDate }) => ({ title, dueDate })),
          today,
        );

        const delivered = await sendModuleEmail({
          to: recipient.email,
          subject,
          body,
          // One deterministic key per (recipient, send day), whatever the digest
          // contains, so a crash between "accepted" and "recorded" cannot mail
          // anyone twice.
          idempotencyKey: `countdown-digest-${userId}-${today}`,
        });

        if (!delivered) {
          // Deliberately not recorded and deliberately not retried today.
          result.failed += 1;
          continue;
        }

        await this._reminderDAO.recordDigest({
          userId,
          // Equal to every document's companyId by construction: the pairing
          // loop above dropped anything that did not match.
          companyId: recipient.companyId,
          sendDate: today,
          documents: rows.map((row) => ({
            documentId: row.id,
            offsetDays: row.offsetDays,
          })),
        });
        result.sent += 1;
      } catch (err) {
        // Counted as failed and left for the next weekday's batch — no retry
        // here, and never silence: the run has to say who it lost.
        // The whole error, not just its message: a programmer error in
        // `buildDigest` arrives here too, and it is worth a stack.
        console.error(
          `[countdown-reminders] digest for user ${userId} failed:`,
          err,
        );
        result.failed += 1;
      }
    }

    return result;
  }

  /**
   * The scheduler's entry point: run the batch unless today's already gone out.
   * Returns null when the day was already claimed, which is the normal answer
   * for fifteen of the sixteen ticks after 08:00.
   *
   * Claiming the day in the database rather than in a variable is what makes the
   * once-a-day guarantee survive a deploy: a container that restarts at 14:00
   * finds the morning already claimed and does nothing, and a container that was
   * down at 08:00 still catches up on its next tick that same day.
   *
   * Kept separate from run() so tests and the superAdmin manual trigger can
   * force a batch without fighting the daily lock.
   */
  async runDailyOnce(): Promise<ICountdownReminderOutcome | null> {
    const runId = await this._reminderDAO.claimToday(todayInBuenosAires());
    if (!runId) return null;

    const outcome = await this.run();
    await this._reminderDAO.recordOutcome(runId, outcome);
    return outcome;
  }
}

const remindersService = new CountdownRemindersService();

let running = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Hourly tick rather than a cron daemon: no extra dependency, no host crontab,
 * and it survives process restarts through the deploy's restart policy.
 *
 * The tick is hourly but the *work* happens once per weekday — the day claim in
 * `countdown_reminder_runs` is what enforces that across ticks and restarts.
 */
export function startReminderScheduler(): void {
  const tick = async (): Promise<void> => {
    if (running) return;
    if (!shouldRunAt(new Date())) return;
    running = true;
    try {
      const outcome = await remindersService.runDailyOnce();
      if (outcome && (outcome.sent || outcome.failed)) {
        console.info(
          `[countdown-reminders] sent=${outcome.sent} failed=${outcome.failed} skipped=${outcome.skipped}`,
        );
      }
    } catch (err) {
      // A scheduler that throws takes the process down with it; log and wait
      // for the next tick instead.
      console.error(
        "[countdown-reminders] run failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      running = false;
    }
  };

  // A short delay on boot so a deploy doesn't send while migrations settle.
  setTimeout(() => void tick(), 60_000).unref();
  timer = setInterval(() => void tick(), 60 * 60 * 1000);
  // Unref'd: a pending timer must never be the reason the process won't exit.
  timer.unref();
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
