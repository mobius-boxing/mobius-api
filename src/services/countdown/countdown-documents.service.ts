import { db } from "../../database/registry";
import { IDataPaginator } from "../../database/d.types";
import { CountdownAssignmentDAO } from "../../dao/countdown/countdown-assignment.dao";
import {
  CountdownCategoryDAO,
  CountdownSubcategoryDAO,
} from "../../dao/countdown/countdown-category.dao";
import {
  COUNTDOWN_EXPORT_ROW_CAP,
  CountdownDocumentDAO,
} from "../../dao/countdown/countdown-document.dao";
import { CountdownPeopleDAO } from "../../dao/countdown/countdown-people.dao";
import {
  CountdownAssignmentsInputDTO,
  CountdownDocumentCreateInputDTO,
  CountdownDocumentStatusInputDTO,
  CountdownDocumentUpdateInputDTO,
} from "../../dto/input/countdown";
import {
  ICountdownAssignmentInput,
  ICountdownAssignmentUuids,
  ICountdownDocument,
  ICountdownDocumentEntry,
  ICountdownDocumentFilters,
  ICountdownDocumentRow,
  ICountdownDocumentSummary,
  ICountdownDocumentWriteInput,
  emptyCountdownAssignments,
} from "../../interfaces/countdown/countdown.interfaces";
import { todayInBuenosAires } from "../../utils/buenosAiresDay";
import { nextDueDate } from "./countdown-recurrence";

/**
 * Everything the module needs to know about the caller, resolved ONCE per
 * request by the controller.
 *
 * `canManage` in particular is a database round trip (RBAC), so it is never
 * computed per row: a page of 100 documents must not become 100 permission
 * queries.
 */
export interface ICountdownRequestContext {
  companyId: number;
  /** users.id of the caller — assignments are stored as serial ids. */
  userId: number;
  /** Admin-equivalent: role admin/superAdmin or the `countdown.manage` grant. */
  canManage: boolean;
}

export interface ICountdownDocumentQuery {
  status: "pending" | "resolved" | "overdue" | "all";
  search?: string | undefined;
  dueFrom?: string | undefined;
  dueTo?: string | undefined;
  /** Rubro uuid — resolved to a company-scoped serial id before it reaches SQL. */
  category?: string | undefined;
  sortBy?: string | undefined;
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
}

/** Carries the HTTP status the controller should answer with. */
export class CountdownServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CountdownServiceError";
  }
}

const notFound = (message: string): CountdownServiceError =>
  new CountdownServiceError(404, message);
const badRequest = (message: string): CountdownServiceError =>
  new CountdownServiceError(400, message);
const forbidden = (message: string): CountdownServiceError =>
  new CountdownServiceError(403, message);

export class CountdownDocumentsService {
  private _documentDAO = new CountdownDocumentDAO();
  private _assignmentDAO = new CountdownAssignmentDAO();
  private _categoryDAO = new CountdownCategoryDAO();
  private _subcategoryDAO = new CountdownSubcategoryDAO();
  private _peopleDAO = new CountdownPeopleDAO();

  // ---- helpers ----------------------------------------------------------

  /**
   * Translate the uuids a client sends into the serial ids the join tables use.
   * Both resolvers are company-scoped (L-009), so a subject from another tenant
   * resolves to nothing instead of being assigned. People go through the same
   * active-user roster the pickers read, so a deactivated account cannot be
   * (re)assigned to chase a document.
   */
  private async resolveAssignmentInput(
    input: ICountdownAssignmentUuids,
    companyId: number,
  ): Promise<ICountdownAssignmentInput> {
    const [resolverUserIds, resolverGroupIds, watcherUserIds, watcherGroupIds] =
      await Promise.all([
        this._peopleDAO.activeIdsByUuids(companyId, input.resolverUsers ?? []),
        this._assignmentDAO.groupIdsByUuids(
          input.resolverGroups ?? [],
          companyId,
        ),
        this._peopleDAO.activeIdsByUuids(companyId, input.watcherUsers ?? []),
        this._assignmentDAO.groupIdsByUuids(
          input.watcherGroups ?? [],
          companyId,
        ),
      ]);
    return {
      resolverUserIds,
      resolverGroupIds,
      watcherUserIds,
      watcherGroupIds,
    };
  }

  /**
   * Attach assignments and work out whether *this* user may resolve each
   * document. Two queries for a whole page, never one per row.
   */
  private async enrich(
    entries: ICountdownDocumentEntry[],
    ctx: ICountdownRequestContext,
  ): Promise<ICountdownDocument[]> {
    if (entries.length === 0) return [];
    const ids = entries.map((entry) => entry.id);

    const [assignments, resolverIds] = await Promise.all([
      this._assignmentDAO.forDocuments(ids),
      this._assignmentDAO.effectiveUserIds(ids, "resolver"),
    ]);

    return entries.map(({ id, document }) => {
      const assigned = assignments.get(id) ?? emptyCountdownAssignments();
      const restricted =
        assigned.resolvers.users.length + assigned.resolvers.groups.length > 0;

      return {
        ...document,
        resolvers: assigned.resolvers,
        watchers: assigned.watchers,
        // Admin-equivalents always can; otherwise an unassigned document is open
        // to everyone and an assigned one is limited to its current effective
        // membership (groups expanded now, never snapshotted).
        canResolve:
          ctx.canManage ||
          !restricted ||
          (resolverIds.get(id)?.has(ctx.userId) ?? false),
      };
    });
  }

  /** A filter set is a filter set — the list, the count and the export share one. */
  private async toFilters(
    query: ICountdownDocumentQuery,
    companyId: number,
  ): Promise<ICountdownDocumentFilters> {
    let categoryId: number | undefined;
    if (query.category) {
      categoryId = await this._categoryDAO.getIdByUuid(
        query.category,
        companyId,
      );
      // Explicit rather than silently returning everything: a filter that is
      // accepted and ignored is the `?search=` bug all over again (L-007). A
      // rubro from another company resolves to nothing and lands here too, so
      // cross-tenant probing answers 404, never 403 (L-009).
      if (!categoryId) throw notFound("Rubro no encontrado");
    }

    return {
      status: query.status,
      search: query.search,
      dueFrom: query.dueFrom,
      dueTo: query.dueTo,
      categoryId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };
  }

  /**
   * Turn the uuids a client sends into the serial ids `countdown_documents`
   * stores, and refuse a sub-rubro that belongs to a different rubro — otherwise
   * a document could claim "Servicios / IVA" and no constraint would notice (the
   * host forbids CHECK constraints, so this IS the constraint).
   */
  private async resolveForDocument(
    categoryUuid: string | undefined,
    subcategoryUuid: string | undefined,
    companyId: number,
  ): Promise<{ categoryId: number | null; subcategoryId: number | null }> {
    if (!categoryUuid) {
      if (subcategoryUuid) {
        throw badRequest("Elegí un rubro antes del sub-rubro");
      }
      return { categoryId: null, subcategoryId: null };
    }

    const categoryId = await this._categoryDAO.getIdByUuid(
      categoryUuid,
      companyId,
    );
    if (!categoryId) throw notFound("Rubro no encontrado");
    if (!subcategoryUuid) return { categoryId, subcategoryId: null };

    return {
      categoryId,
      subcategoryId: await this.resolveSubcategoryId(
        subcategoryUuid,
        categoryId,
        companyId,
      ),
    };
  }

  /**
   * The sub-rubro half of the resolution above, extracted so a patch that
   * carries a sub-rubro and no rubro can validate it against the rubro the
   * document already has (D-2/AC-9) with the same rules — one resolver, two
   * callers, never two copies that drift.
   */
  private async resolveSubcategoryId(
    subcategoryUuid: string,
    categoryId: number,
    companyId: number,
  ): Promise<number> {
    const subcategory = await this._subcategoryDAO.findByUuid(
      subcategoryUuid,
      companyId,
    );
    if (!subcategory) throw notFound("Sub-rubro no encontrado");
    if (subcategory.categoryId !== categoryId) {
      throw badRequest("El sub-rubro no pertenece a ese rubro");
    }
    return subcategory.id;
  }

  private async getWithToday(
    uuid: string,
    ctx: ICountdownRequestContext,
    today: string,
  ): Promise<ICountdownDocument> {
    const entry = await this._documentDAO.findByUuid(
      uuid,
      ctx.companyId,
      today,
    );
    if (!entry) throw notFound("Documento no encontrado");
    const [enriched] = await this.enrich([entry], ctx);
    if (!enriched) throw notFound("Documento no encontrado");
    return enriched;
  }

  // ---- reads ------------------------------------------------------------

  async list(
    query: ICountdownDocumentQuery,
    ctx: ICountdownRequestContext,
  ): Promise<IDataPaginator<ICountdownDocument>> {
    const today = todayInBuenosAires();
    const filters = await this.toFilters(query, ctx.companyId);
    const { rows, totalCount } = await this._documentDAO.list(
      ctx.companyId,
      filters,
      today,
      query.page,
      query.limit,
    );
    const data = await this.enrich(rows, ctx);

    return {
      success: true,
      data,
      page: query.page,
      limit: query.limit,
      count: data.length,
      totalCount,
      totalPages: Math.ceil(totalCount / query.limit),
    };
  }

  /** Every matching row, for the Excel export. Reports its own truncation. */
  async listForExport(
    query: ICountdownDocumentQuery,
    ctx: ICountdownRequestContext,
  ): Promise<{ documents: ICountdownDocument[]; truncated: boolean }> {
    const today = todayInBuenosAires();
    const filters = await this.toFilters(query, ctx.companyId);
    const rows = await this._documentDAO.listAll(ctx.companyId, filters, today);
    if (rows.length === COUNTDOWN_EXPORT_ROW_CAP) {
      console.warn(
        `[countdown][export] capped at ${COUNTDOWN_EXPORT_ROW_CAP} rows — the file is incomplete`,
      );
    }
    return {
      documents: await this.enrich(rows, ctx),
      truncated: rows.length === COUNTDOWN_EXPORT_ROW_CAP,
    };
  }

  async get(
    uuid: string,
    ctx: ICountdownRequestContext,
  ): Promise<ICountdownDocument> {
    return this.getWithToday(uuid, ctx, todayInBuenosAires());
  }

  summary(ctx: ICountdownRequestContext): Promise<ICountdownDocumentSummary> {
    return this._documentDAO.summary(ctx.companyId, todayInBuenosAires());
  }

  // ---- writes -----------------------------------------------------------

  async create(
    uuid: string,
    input: CountdownDocumentCreateInputDTO,
    ctx: ICountdownRequestContext,
  ): Promise<ICountdownDocument> {
    const { categoryId, subcategoryId } = await this.resolveForDocument(
      input.category,
      input.subcategory,
      ctx.companyId,
    );

    const created = await this._documentDAO.create(uuid, {
      companyId: ctx.companyId,
      title: input.title,
      issuer: input.issuer ?? null,
      referenceNumber: input.referenceNumber ?? null,
      categoryId,
      subcategoryId,
      notes: input.notes ?? null,
      amountCents: input.amountCents ?? null,
      currency: input.currency,
      dueDate: input.dueDate,
      recurrenceCount: input.recurrenceCount ?? null,
      recurrenceUnit: input.recurrenceUnit ?? null,
      // Spread conditionally: an absent threshold must leave the key out of the
      // insert so the column default (7) applies. `reminderDays: undefined`
      // would be a binding, not a default.
      ...(input.reminderDays !== undefined
        ? { reminderDays: input.reminderDays }
        : {}),
      uploadedBy: ctx.userId,
    });

    // (L-005) explicit id resolution, scoped to the company.
    const id = await this._documentDAO.getIdByUuid(created, ctx.companyId);
    if (id) {
      await this._assignmentDAO.replace(
        id,
        await this.resolveAssignmentInput(input, ctx.companyId),
      );
    }

    return this.get(created, ctx);
  }

  async update(
    uuid: string,
    patch: CountdownDocumentUpdateInputDTO,
    ctx: ICountdownRequestContext,
  ): Promise<ICountdownDocument> {
    // The whole row, not just the id (L-005 + L-009: uuid AND companyId): the
    // stored `categoryId` is what a sub-rubro sent on its own is validated
    // against, and reading it here costs the same single query.
    const row = await this._documentDAO.getRowByUuid(uuid, ctx.companyId);
    if (!row) throw notFound("Documento no encontrado");
    const id = row.id;

    // The rubro/sub-rubro matrix, in wire terms: `null` clears, absent leaves
    // the column untouched, a uuid sets it.
    //
    // - `category` sent (uuid or null) → the pair is resolved together, so a
    //   rubro that moves or clears never leaves its old sub-rubro behind.
    // - `subcategory` alone → validated against the STORED rubro, because the
    //   patch is complete without a field the caller is not changing (D-2). A
    //   200 that quietly dropped it is the accepted-but-ignored trap (L-007).
    // - neither sent → both columns stay out of the patch entirely.
    let categoryPatch:
      | { categoryId: number | null; subcategoryId: number | null }
      | { subcategoryId: number | null }
      | undefined;
    if (patch.category !== undefined) {
      categoryPatch = await this.resolveForDocument(
        patch.category ?? undefined,
        patch.subcategory ?? undefined,
        ctx.companyId,
      );
    } else if (patch.subcategory === null) {
      // A no-op clear on a document that has no rubro either, never an error.
      categoryPatch = { subcategoryId: null };
    } else if (patch.subcategory !== undefined) {
      if (row.categoryId === null) {
        throw badRequest("Elegí un rubro antes del sub-rubro");
      }
      categoryPatch = {
        subcategoryId: await this.resolveSubcategoryId(
          patch.subcategory,
          row.categoryId,
          ctx.companyId,
        ),
      };
    }

    await this._documentDAO.update(id, ctx.companyId, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.issuer !== undefined ? { issuer: patch.issuer } : {}),
      ...(patch.referenceNumber !== undefined
        ? { referenceNumber: patch.referenceNumber }
        : {}),
      ...(categoryPatch ?? {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.amountCents !== undefined
        ? { amountCents: patch.amountCents }
        : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.recurrenceCount !== undefined
        ? {
            recurrenceCount: patch.recurrenceCount,
            recurrenceUnit: patch.recurrenceUnit ?? null,
          }
        : {}),
      ...(patch.reminderDays !== undefined
        ? { reminderDays: patch.reminderDays }
        : {}),
    });

    return this.get(uuid, ctx);
  }

  /** Replaces the whole assignment set. Permission-gated at the route. */
  async setAssignments(
    uuid: string,
    input: CountdownAssignmentsInputDTO,
    ctx: ICountdownRequestContext,
  ): Promise<ICountdownDocument> {
    const id = await this._documentDAO.getIdByUuid(uuid, ctx.companyId);
    if (!id) throw notFound("Documento no encontrado");
    await this._assignmentDAO.replace(
      id,
      await this.resolveAssignmentInput(input, ctx.companyId),
    );
    return this.get(uuid, ctx);
  }

  /**
   * Resolve, and optionally create the next occurrence in the same breath.
   *
   * The two writes plus the assignment copy run in one transaction: a crash
   * between them would either lose the renewal or resolve nothing, and a
   * half-renewed month is silent data loss.
   */
  async setStatus(
    uuid: string,
    body: CountdownDocumentStatusInputDTO,
    renewalUuid: string,
    ctx: ICountdownRequestContext,
  ): Promise<{
    document: ICountdownDocument;
    renewed: ICountdownDocument | null;
  }> {
    const today = todayInBuenosAires();
    const entry = await this._documentDAO.findByUuid(
      uuid,
      ctx.companyId,
      today,
    );
    if (!entry) throw notFound("Documento no encontrado");

    // The permission check runs here, not just in the UI that hides the button:
    // canResolve is advisory to the client and binding on the server, and it is
    // recomputed on every status change (group membership may have moved since
    // the page was rendered).
    const [enriched] = await this.enrich([entry], ctx);
    if (!enriched?.canResolve) {
      throw forbidden("No estás asignado para resolver este documento");
    }

    const source = enriched;

    if (!body.renew) {
      await this._documentDAO.setStatus(
        entry.id,
        ctx.companyId,
        body.status,
        body.status === "resolved" ? ctx.userId : null,
      );
      return {
        document: await this.getWithToday(uuid, ctx, today),
        renewed: null,
      };
    }

    const due =
      body.nextDueDate ??
      (source.recurrence
        ? nextDueDate(
            source.dueDate,
            source.recurrence.count,
            source.recurrence.unit,
          )
        : null);
    if (!due) {
      throw badRequest(
        "Este documento no se repite: indicá el próximo vencimiento",
      );
    }

    const row: ICountdownDocumentRow | undefined =
      await this._documentDAO.getRowByUuid(uuid, ctx.companyId);
    if (!row) throw notFound("Documento no encontrado");

    const copy: ICountdownDocumentWriteInput = {
      companyId: ctx.companyId,
      title: row.title,
      issuer: row.issuer,
      referenceNumber: row.referenceNumber,
      categoryId: row.categoryId,
      subcategoryId: row.subcategoryId,
      notes: row.notes,
      amountCents: row.amountCents,
      currency: row.currency,
      dueDate: due,
      recurrenceCount: row.recurrenceCount,
      recurrenceUnit: row.recurrenceUnit,
      // Copied field by field, so anything omitted here is lost in silence: the
      // renewal keeps the source document's reminder threshold.
      reminderDays: row.reminderDays,
      // Whoever renews it owns the new one; the original keeps its own history.
      uploadedBy: ctx.userId,
    };

    // The same people chase it next period. Resolved BEFORE the transaction
    // opens: these are plain reads, and running them inside would hold the
    // transaction's connection while borrowing more from the same small pool.
    const copiedAssignments = await this.resolveAssignmentInput(
      {
        resolverUsers: source.resolvers.users.map((user) => user.uuid),
        resolverGroups: source.resolvers.groups.map((group) => group.uuid),
        watcherUsers: source.watchers.users.map((user) => user.uuid),
        watcherGroups: source.watchers.groups.map((group) => group.uuid),
      },
      ctx.companyId,
    );

    const knex = db("countdown");
    await knex.transaction(async (trx) => {
      await this._documentDAO.setStatus(
        entry.id,
        ctx.companyId,
        body.status,
        ctx.userId,
        trx,
      );
      await this._documentDAO.create(renewalUuid, copy, trx);

      const renewedRow = await trx("countdown_documents")
        .select("id")
        .where({ uuid: renewalUuid, companyId: ctx.companyId })
        .first();
      if (!renewedRow) {
        throw new Error(
          "[countdown] renewed row vanished inside its own transaction",
        );
      }

      await this._assignmentDAO.replace(
        renewedRow.id as number,
        copiedAssignments,
        trx,
      );
    });

    return {
      document: await this.getWithToday(uuid, ctx, today),
      renewed: await this.getWithToday(renewalUuid, ctx, today),
    };
  }

  /** Returns what was deleted, so the caller can audit the snapshot. */
  async remove(
    uuid: string,
    ctx: ICountdownRequestContext,
  ): Promise<ICountdownDocument> {
    const today = todayInBuenosAires();
    const entry = await this._documentDAO.findByUuid(
      uuid,
      ctx.companyId,
      today,
    );
    if (!entry) throw notFound("Documento no encontrado");
    // countdown_document_assignments and countdown_reminder_log cascade; neither
    // owns side state (L-006: one deletion strategy per entity, and this is it).
    // countdown_reminder_digests does NOT hang off a document and is left alone:
    // its `documentCount` is a historical snapshot of what was actually sent
    // that day, not a live count, so deleting a document must not change it.
    await this._documentDAO.delete(entry.id, ctx.companyId);
    return entry.document;
  }
}
