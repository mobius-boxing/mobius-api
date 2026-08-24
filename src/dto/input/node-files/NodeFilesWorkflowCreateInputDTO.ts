import {
  INodeFilesDefinition,
  INodeFilesField,
  NODE_FILES_WORKFLOW_STATUSES,
  NodeFilesWorkflowStatus,
} from "../../../interfaces/node-files/node-files.interfaces";
import { parseDefinition } from "../../../services/node-files/definition";
import {
  emptyToUndefined,
  optionalText,
  parseFields,
  requiredText,
  toBoolean,
} from "./NodeFilesFieldsInput";

function parseStatus(value: unknown): NodeFilesWorkflowStatus | undefined {
  const raw = emptyToUndefined(value);
  if (raw === undefined || raw === null) return undefined;
  if (
    typeof raw !== "string" ||
    !NODE_FILES_WORKFLOW_STATUSES.includes(raw as NodeFilesWorkflowStatus)
  ) {
    throw new Error(
      `Estado inválido: usá ${NODE_FILES_WORKFLOW_STATUSES.join(", ")}`,
    );
  }
  return raw as NodeFilesWorkflowStatus;
}

/** Create payload for a workflow. Defaults live in the constructor (host rule). */
export class NodeFilesWorkflowCreateInputDTO {
  name: string;
  description: string | null;
  requireReview: boolean;
  status: NodeFilesWorkflowStatus;
  fields: INodeFilesField[];
  /**
   * Shape-parsed here; the graph RULES (one trigger, no cycles, configs, the
   * credentials it references) are checked in the service, which is the only
   * layer that can ask the database whether a credential exists.
   */
  definition: INodeFilesDefinition | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    this.name = typeof source.name === "string" ? source.name.trim() : "";
    this.description =
      optionalText(source.description, 1000, "La descripción") ?? null;
    this.requireReview =
      toBoolean(source.requireReview, "Revisión manual") ?? false;
    this.status = parseStatus(source.status) ?? "draft";
    this.fields = parseFields(source.fields);
    this.definition =
      source.definition === undefined || source.definition === null
        ? null
        : parseDefinition(source.definition);
  }

  /** Throws on anything the table would accept but the business would not. */
  public build(): this {
    this.name = requiredText(this.name, 120, "El nombre");
    return this;
  }
}

export { parseStatus as parseWorkflowStatus };
