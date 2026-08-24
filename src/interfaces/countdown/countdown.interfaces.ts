/**
 * Shapes for the countdown module (document-expiration tracking).
 *
 * The public shapes carry uuids only — numeric ids never leave the API
 * (`sanitizeResponse` strips them globally, but the mappers must not produce
 * them in the first place). Row shapes are the internal DB view and stay inside
 * the DAO/service layer.
 */

export type CountdownDocumentStatus = "pending" | "resolved";
export type CountdownRecurrenceUnit = "day" | "month" | "year";
export type CountdownAssignmentKind = "resolver" | "watcher";

/** Anything the UI shows as a chip: a uuid and something to print. */
export interface INamedRef {
  uuid: string;
  name: string;
}

/** The full row, including the serial ids the API must never expose. */
export interface ICountdownDocumentRow {
  id: number;
  uuid: string;
  companyId: number;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  categoryId: number | null;
  subcategoryId: number | null;
  notes: string | null;
  amountCents: number | null;
  currency: string;
  /** 'YYYY-MM-DD' — the DATE type parser keeps it a string on purpose. */
  dueDate: string;
  status: CountdownDocumentStatus;
  recurrenceCount: number | null;
  recurrenceUnit: CountdownRecurrenceUnit | null;
  /** Days before the due date this document starts being reminded about. */
  reminderDays: number;
  resolvedAt: Date | null;
  resolvedBy: number | null;
  uploadedBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICountdownAssignments {
  resolvers: { users: INamedRef[]; groups: INamedRef[] };
  watchers: { users: INamedRef[]; groups: INamedRef[] };
}

export function emptyCountdownAssignments(): ICountdownAssignments {
  return {
    resolvers: { users: [], groups: [] },
    watchers: { users: [], groups: [] },
  };
}

/** What the API returns for one document. */
export interface ICountdownDocument extends ICountdownAssignments {
  uuid: string;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  category: INamedRef | null;
  subcategory: INamedRef | null;
  notes: string | null;
  amountCents: number | null;
  currency: string;
  dueDate: string;
  status: CountdownDocumentStatus;
  /** null when the document does not repeat. */
  recurrence: { count: number; unit: CountdownRecurrenceUnit } | null;
  /**
   * The reminder window, in days: the document is reported on every send day
   * from `dueDate - reminderDays` onward, and keeps being reported after the
   * due date until it is resolved. 0 means "only from the due date onward".
   */
  reminderDays: number;
  /** Derived from the customer's calendar day — never stored. */
  overdue: boolean;
  daysUntilDue: number;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  uploadedBy: INamedRef | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether the *requesting* user may resolve this one. UI advice only — the
   * server re-checks on every status change. Hiding a button is never the
   * security boundary.
   */
  canResolve: boolean;
}

/** A public document plus the serial id its enrichment queries need. */
export interface ICountdownDocumentEntry {
  id: number;
  document: ICountdownDocument;
}

export interface ICountdownDocumentFilters {
  status: "pending" | "resolved" | "overdue" | "all";
  search?: string | undefined;
  dueFrom?: string | undefined;
  dueTo?: string | undefined;
  /** Resolved from a uuid by the service — the count query has no join to use. */
  categoryId?: number | undefined;
  sortBy?: string | undefined;
  sortOrder: "asc" | "desc";
}

export interface ICountdownDocumentSummary {
  pendingCount: number;
  overdueCount: number;
  dueTodayCount: number;
  dueIn7Count: number;
  dueIn30Count: number;
  resolvedCount: number;
  pendingAmountCents: number;
  overdueAmountCents: number;
}

/** Everything a document row needs on insert; ids already resolved. */
export interface ICountdownDocumentWriteInput {
  companyId: number;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  categoryId: number | null;
  subcategoryId: number | null;
  notes: string | null;
  amountCents: number | null;
  currency: string;
  dueDate: string;
  recurrenceCount: number | null;
  recurrenceUnit: CountdownRecurrenceUnit | null;
  /** Omitted entirely when the caller did not ask for one — the column default
   *  (7) is what applies, and `undefined` must never reach the insert. */
  reminderDays?: number;
  uploadedBy: number;
}

/** Assignment sets as numeric ids, ready for the join table. */
export interface ICountdownAssignmentInput {
  resolverUserIds: number[];
  resolverGroupIds: number[];
  watcherUserIds: number[];
  watcherGroupIds: number[];
}

/** The same sets as the API accepts them: uuids. */
export interface ICountdownAssignmentUuids {
  resolverUsers?: string[];
  resolverGroups?: string[];
  watcherUsers?: string[];
  watcherGroups?: string[];
}

export interface ICountdownSubcategory {
  uuid: string;
  name: string;
  /** Documents pointing at this sub-rubro — shown in admin, and the delete
   *  guard refuses on it. */
  documentCount: number;
}

export interface ICountdownCategory {
  uuid: string;
  name: string;
  subcategories: ICountdownSubcategory[];
  documentCount: number;
  createdAt: Date;
}

export interface ICountdownGroup {
  uuid: string;
  name: string;
  members: INamedRef[];
  createdAt: Date;
}

/**
 * What one reminder batch did. The shape is unchanged, the units are not: the
 * batch now sends one digest per recipient per send day, not one email per
 * (document, recipient, offset).
 */
export interface ICountdownReminderOutcome {
  /** Digests the provider accepted — at most one per recipient per send day. */
  sent: number;
  /**
   * Digests the provider rejected, plus any digest whose recording failed after
   * the provider accepted it — see `run()`. The two are opposite situations:
   * the first means nobody was mailed, the second means somebody was mailed and
   * the bookkeeping is missing. Neither is retried today.
   */
  failed: number;
  /** Recipients skipped: inactive, cross-tenant, or already digested today. */
  skipped: number;
}
