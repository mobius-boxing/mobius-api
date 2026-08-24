/**
 * node-files — document extraction (module slug `node-files`, database key
 * `nodefiles`).
 *
 * Public shapes are UUID-only: numeric ids and numeric FKs never leave the API
 * (`sanitizeResponse` strips them globally, and every `mapToInterface` here
 * already omits them).
 */

/** What a declared field can be. Drives both the Zod schema and the coercion. */
export const NODE_FILES_FIELD_TYPES = [
  "string",
  "number",
  "currency",
  "date",
  "boolean",
  "list",
] as const;

export type NodeFilesFieldType = (typeof NODE_FILES_FIELD_TYPES)[number];

/** One declared field of a workflow's extraction schema (stored as jsonb). */
export interface INodeFilesField {
  /** Stable identifier used as the key of `extracted` — never shown to a user. */
  key: string;
  /** What the human calls it; goes to the model as part of the schema. */
  label: string;
  type: NodeFilesFieldType;
  /** Optional hint handed to the model, e.g. "el total con IVA". */
  description: string | null;
  /** A required field that comes back null fails validation of the run. */
  required: boolean;
}

export const NODE_FILES_WORKFLOW_STATUSES = [
  "draft",
  "active",
  "disabled",
] as const;
export type NodeFilesWorkflowStatus =
  (typeof NODE_FILES_WORKFLOW_STATUSES)[number];

/**
 * queued → extracting → (pending_review →) succeeded, or failed at any point.
 * `pending_review` is only reached when the workflow asks for review.
 */
export const NODE_FILES_RUN_STATUSES = [
  "queued",
  "extracting",
  "pending_review",
  "succeeded",
  "failed",
] as const;
export type NodeFilesRunStatus = (typeof NODE_FILES_RUN_STATUSES)[number];

/** One extracted value plus how sure the model was (0..1). */
export interface INodeFilesExtractedValue {
  value: string | number | boolean | string[] | null;
  confidence: number;
}

export type NodeFilesExtractedValues = Record<string, INodeFilesExtractedValue>;

export interface INodeFilesWorkflow {
  uuid: string;
  name: string;
  description: string | null;
  requireReview: boolean;
  status: NodeFilesWorkflowStatus;
  fields: INodeFilesField[];
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface INodeFilesDocument {
  uuid: string;
  originalName: string;
  contentType: string;
  sizeBytes: number | null;
  checksum: string | null;
  uploadedByName: string | null;
  createdAt: Date;
}

export interface INodeFilesRun {
  uuid: string;
  status: NodeFilesRunStatus;
  workflowUuid: string;
  workflowName: string;
  documentUuid: string;
  documentName: string;
  extracted: NodeFilesExtractedValues | null;
  reviewedValues: NodeFilesExtractedValues | null;
  reviewedByName: string | null;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A claimed run as the worker needs it — numeric ids included, because it never
 * leaves the process. `companyId` travels with the row so every follow-up DAO
 * call is scoped to the tenant that owns it (L-009), even though the claim
 * itself is process-wide.
 */
export interface INodeFilesClaimedRun {
  id: number;
  uuid: string;
  companyId: number;
  workflowId: number;
  documentId: number;
}

/** Row shapes as they come back from Postgres (camelCase quoted columns). */
export interface INodeFilesWorkflowRow {
  id: number;
  uuid: string;
  companyId: number;
  name: string;
  description: string | null;
  requireReview: boolean;
  status: NodeFilesWorkflowStatus;
  fields: INodeFilesField[];
  createdByUserId: number | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface INodeFilesDocumentRow {
  id: number;
  uuid: string;
  workflowId: number;
  companyId: number;
  storageKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: string | number | null;
  checksum: string | null;
  uploadedByUserId: number | null;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface INodeFilesRunRow {
  id: number;
  uuid: string;
  workflowId: number;
  documentId: number;
  companyId: number;
  status: NodeFilesRunStatus;
  extracted: NodeFilesExtractedValues | null;
  reviewedValues: NodeFilesExtractedValues | null;
  reviewedByUserId: number | null;
  reviewedByName: string | null;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
