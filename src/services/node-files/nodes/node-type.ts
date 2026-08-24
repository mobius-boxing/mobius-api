import {
  INodeFilesConfigInput,
  INodeFilesField,
  INodeFilesNodeTypeDescriptor,
  NodeFilesHandle,
  NodeFilesNodeType,
} from "../../../interfaces/node-files/node-files.interfaces";

/**
 * The node contract, shaped exactly like `IExtractionProvider` next door:
 * an interface, a factory that resolves an implementation by name, and a typed
 * error whose message is tenant-facing. Nothing about a node type is known to
 * the executor except what is on this interface.
 *
 * A node type is FOUR things, and all four live in one file per type:
 *   - `descriptor` — what `GET /node-types` publishes, including the config
 *     schema the editor renders. This is what makes "adding a node type must
 *     never require a bespoke React component" true rather than aspirational.
 *   - `validate` — called when a definition is SAVED, so a broken config is a
 *     400 at save time and not a failed run an hour later.
 *   - `credentialRefs` — which credentials the config points at, so the save
 *     can check they exist in this company and maintain
 *     `nf_workflow_credentials`.
 *   - `run` — the execution itself, which holds ZERO database connections.
 */

/**
 * A node failure whose message IS shown to the tenant: Spanish, no internals,
 * no upstream response bodies. Anything else thrown by a node is a bug and the
 * executor replaces it with a generic message after logging it.
 */
export class NodeExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeExecutionError";
  }
}

/** A config rejected at save time. The controller turns it into a 400. */
export class NodeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeConfigError";
  }
}

/** A credential, decrypted, as the executor hands it to a node. */
export interface INodeCredential {
  uuid: string;
  name: string;
  /** Header name and value, already assembled from the credential's type. */
  headerName: string;
  headerValue: string;
}

/**
 * Everything a node may read. Deliberately a plain data object plus two
 * functions: a node cannot reach a DAO, a connection, the request, or the
 * tenant's other runs, because none of them are here.
 */
export interface INodeRunContext {
  document: { name: string; contentType: string };
  /** Confirmed values if the run was reviewed, otherwise what was extracted. */
  fields: Record<string, unknown>;
  /** Declared types, so the condition node compares like with like. */
  fieldTypes: Record<string, string>;
  /** Outputs of the nodes that already ran, keyed by node id. */
  nodes: Record<string, Record<string, unknown>>;
  /** Decrypted credentials, resolved before the node starts. */
  credentials: Map<string, INodeCredential>;
  /** Appended to `nf_node_runs.logs`, capped by the executor. */
  log: (message: string) => void;
}

export interface INodeRunResult {
  output: Record<string, unknown>;
  /** Which outgoing handle the executor follows. */
  handle: NodeFilesHandle;
}

/** What `validate` may consult: the workflow's declared extraction fields. */
export interface INodeValidationContext {
  fields: INodeFilesField[];
}

export interface INodeType {
  type: NodeFilesNodeType;
  label: string;
  description: string;
  handles: NodeFilesHandle[];
  /** False only for the trigger: nothing may point at the start of the graph. */
  acceptsInput: boolean;
  configSchema: INodeFilesConfigInput[];
  /** Throws `NodeConfigError` on anything the editor should have refused. */
  validate(config: Record<string, unknown>, ctx: INodeValidationContext): void;
  /** Credential uuids this config references. Empty for most node types. */
  credentialRefs(config: Record<string, unknown>): string[];
  run(
    ctx: INodeRunContext,
    config: Record<string, unknown>,
  ): Promise<INodeRunResult>;
}

/** Descriptor projection — the wire shape, derived from the type itself. */
export function toDescriptor(node: INodeType): INodeFilesNodeTypeDescriptor {
  return {
    type: node.type,
    label: node.label,
    description: node.description,
    handles: node.handles,
    acceptsInput: node.acceptsInput,
    configSchema: node.configSchema,
  };
}

/** Small helper so every node type declares its inputs the same way. */
export function configInput(
  input: Partial<INodeFilesConfigInput> &
    Pick<INodeFilesConfigInput, "key" | "label" | "input">,
): INodeFilesConfigInput {
  return {
    key: input.key,
    label: input.label,
    input: input.input,
    required: input.required ?? false,
    options: input.options ?? [],
    templated: input.templated ?? false,
    placeholder: input.placeholder ?? null,
    help: input.help ?? null,
    defaultValue: input.defaultValue ?? null,
  };
}

/** Config readers that throw the save-time error rather than coercing. */
export function requiredConfigText(
  config: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new NodeConfigError(`${label} es obligatorio`);
  }
  if (value.length > max) {
    throw new NodeConfigError(
      `${label} no puede superar los ${max} caracteres`,
    );
  }
  return value.trim();
}

export function optionalConfigText(
  config: Record<string, unknown>,
  key: string,
  label: string,
  max: number,
): string | null {
  const value = config[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new NodeConfigError(`${label} debe ser texto`);
  }
  if (value.length > max) {
    throw new NodeConfigError(
      `${label} no puede superar los ${max} caracteres`,
    );
  }
  return value.trim();
}
