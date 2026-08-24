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
 * queued → extracting → (pending_review →) running → succeeded, or failed at
 * any point. `pending_review` is only reached when the workflow asks for
 * review; `running` is the executor walking the workflow's node graph, and a
 * workflow with no graph passes straight through it.
 */
export const NODE_FILES_RUN_STATUSES = [
  "queued",
  "extracting",
  "pending_review",
  "running",
  "succeeded",
  "failed",
] as const;
export type NodeFilesRunStatus = (typeof NODE_FILES_RUN_STATUSES)[number];

/**
 * The statuses a run can be in while it still belongs to the engine. Editing or
 * deleting a workflow with a run in ANY of them is a 409: the executor is about
 * to read, or is already reading, the definition it would change under it.
 */
export const NODE_FILES_ACTIVE_RUN_STATUSES: readonly NodeFilesRunStatus[] = [
  "queued",
  "extracting",
  "pending_review",
  "running",
];

/**
 * One node's outcome. Written ONCE, when the node is over — there is no
 * `running` node-run row, because the row is the record of what happened, and a
 * row saying "running" that a crashed worker leaves behind is a lie nobody
 * sweeps.
 */
export const NODE_FILES_NODE_RUN_STATUSES = [
  "succeeded",
  "failed",
  "skipped",
] as const;
export type NodeFilesNodeRunStatus =
  (typeof NODE_FILES_NODE_RUN_STATUSES)[number];

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
  /** The node graph. `null` for a Phase 1 workflow that only extracts. */
  definition: INodeFilesDefinition | null;
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
  definition: INodeFilesDefinition | null;
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

// ---- Phase 2: the workflow engine -----------------------------------------

/**
 * The node types the registry ships. A string union rather than a free string:
 * the definition validator, the config schemas and the executor all switch on
 * it, and every one of those switches is exhaustive by construction.
 */
export const NODE_FILES_NODE_TYPES = [
  "trigger",
  "condition",
  "email",
  "http",
] as const;
export type NodeFilesNodeType = (typeof NODE_FILES_NODE_TYPES)[number];

/**
 * Condition operators (brief D-2). Structured comparison, NOT an expression
 * language: `{ left: <field key>, op, right: <literal> }`. There is no parser
 * here on purpose — the alternative evaluators in this repo return 0 silently
 * on error, and a branch gate that silently answers "false" on a typo is the
 * worst failure a workflow engine can have.
 */
export const NODE_FILES_CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "isEmpty",
  "isNotEmpty",
] as const;
export type NodeFilesConditionOp = (typeof NODE_FILES_CONDITION_OPS)[number];

/** Where an edge leaves a node. Only the condition node has two. */
export const NODE_FILES_HANDLES = ["out", "true", "false"] as const;
export type NodeFilesHandle = (typeof NODE_FILES_HANDLES)[number];

/** Canvas coordinates. Stored, validated, and completely ignored by the engine. */
export interface INodeFilesNodePosition {
  x: number;
  y: number;
}

export interface INodeFilesDefinitionNode {
  /**
   * Unique within the definition; the SAME value that lands in
   * `nf_node_runs.nodeId`.
   *
   * Not called `id`, and that is not a style choice: `sanitizeResponse`
   * recursively deletes every `id` key from every response body (it is the
   * UUID-only guarantee, and it cannot tell a numeric primary key from a
   * canvas node's name). A definition with `id` on its nodes would reach the
   * editor with every node anonymous. `nodeId` is a string ending in `Id`,
   * which that middleware preserves by design.
   */
  nodeId: string;
  type: NodeFilesNodeType;
  /** Free-form per node type, validated against that type's config schema. */
  config: Record<string, unknown>;
  position: INodeFilesNodePosition;
}

export interface INodeFilesDefinitionEdge {
  /** Same reasoning as `nodeId` above — never `id`. */
  edgeId: string;
  source: string;
  target: string;
  /** `out` on every node but the condition, which branches `true`/`false`. */
  sourceHandle: NodeFilesHandle;
}

export interface INodeFilesDefinition {
  nodes: INodeFilesDefinitionNode[];
  edges: INodeFilesDefinitionEdge[];
}

/**
 * One rendered form control in the editor's config panel.
 *
 * This is the whole reason `GET /node-types` exists: adding a node type is a
 * backend file and nothing else, because the panel is generated from these
 * descriptors. `fieldKey` and `credential` are pickers the frontend fills from
 * data it already has (the workflow's declared fields, `GET /credentials`).
 */
export const NODE_FILES_CONFIG_INPUT_TYPES = [
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "fieldKey",
  "credential",
  "keyValue",
] as const;
export type NodeFilesConfigInputType =
  (typeof NODE_FILES_CONFIG_INPUT_TYPES)[number];

export interface INodeFilesConfigOption {
  value: string;
  label: string;
}

export interface INodeFilesConfigInput {
  key: string;
  label: string;
  input: NodeFilesConfigInputType;
  required: boolean;
  /** Present for `select`; empty otherwise. */
  options: INodeFilesConfigOption[];
  /** Whether `{{campos.total}}` substitution applies to this input. */
  templated: boolean;
  placeholder: string | null;
  help: string | null;
  defaultValue: string | number | boolean | null;
}

/** One entry of `GET /node-types`. */
export interface INodeFilesNodeTypeDescriptor {
  type: NodeFilesNodeType;
  label: string;
  description: string;
  /** Which outgoing handles the canvas may draw from this node. */
  handles: NodeFilesHandle[];
  /** Whether an edge may point AT this node (the trigger starts the graph). */
  acceptsInput: boolean;
  configSchema: INodeFilesConfigInput[];
}

export interface INodeFilesNodeRun {
  uuid: string;
  nodeId: string;
  nodeType: string;
  status: NodeFilesNodeRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  logs: string | null;
  error: string | null;
  durationMs: number | null;
  attempt: number;
  createdAt: Date;
}

export interface INodeFilesNodeRunRow {
  id: number;
  uuid: string;
  runId: number;
  companyId: number;
  nodeId: string;
  nodeType: string;
  status: NodeFilesNodeRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  logs: string | null;
  error: string | null;
  durationMs: number | null;
  attempt: number;
  createdAt: Date;
  updatedAt: Date;
}

/** How a credential is applied to an outbound request. */
export const NODE_FILES_CREDENTIAL_TYPES = ["bearer", "header"] as const;
export type NodeFilesCredentialType =
  (typeof NODE_FILES_CREDENTIAL_TYPES)[number];

/**
 * A credential as it leaves the API — which is to say, without its secret.
 * There is deliberately no `secret`, no `secretMasked` and no `secretLength`
 * field: the write-only rule is enforced by this type having nowhere to put one.
 */
export interface INodeFilesCredential {
  uuid: string;
  name: string;
  type: NodeFilesCredentialType;
  headerName: string | null;
  lastUsedAt: Date | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface INodeFilesCredentialRow {
  id: number;
  uuid: string;
  companyId: number;
  name: string;
  type: NodeFilesCredentialType;
  headerName: string | null;
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  lastUsedAt: Date | null;
  createdByUserId: number | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}
