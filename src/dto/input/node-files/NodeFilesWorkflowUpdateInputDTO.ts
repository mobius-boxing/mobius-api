import {
  INodeFilesDefinition,
  INodeFilesField,
  NodeFilesWorkflowStatus,
} from "../../../interfaces/node-files/node-files.interfaces";
import { parseDefinition } from "../../../services/node-files/definition";
import { parseWorkflowStatus } from "./NodeFilesWorkflowCreateInputDTO";
import {
  optionalText,
  parseFields,
  requiredText,
  toBoolean,
} from "./NodeFilesFieldsInput";

/**
 * PATCH payload: only the keys actually present are set, and `build()` refuses
 * an empty patch rather than answering 200 to a request that changed nothing.
 */
export class NodeFilesWorkflowUpdateInputDTO {
  name?: string;
  description?: string | null;
  requireReview?: boolean;
  status?: NodeFilesWorkflowStatus;
  fields?: INodeFilesField[];
  definition?: INodeFilesDefinition | null;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    if (source.name !== undefined) {
      this.name = requiredText(source.name, 120, "El nombre");
    }
    if (source.description !== undefined) {
      this.description =
        optionalText(source.description, 1000, "La descripción") ?? null;
    }
    if (source.requireReview !== undefined) {
      const requireReview = toBoolean(source.requireReview, "Revisión manual");
      if (requireReview !== undefined) this.requireReview = requireReview;
    }
    if (source.status !== undefined) {
      const status = parseWorkflowStatus(source.status);
      if (status !== undefined) this.status = status;
    }
    if (source.fields !== undefined) {
      this.fields = parseFields(source.fields);
    }
    if (source.definition !== undefined) {
      // `null` is a real value here: it clears the graph and turns the flow
      // back into extraction-only.
      this.definition =
        source.definition === null ? null : parseDefinition(source.definition);
    }
  }

  public build(): this {
    if (Object.keys(this).length === 0) {
      throw new Error("No hay cambios para guardar");
    }
    return this;
  }
}
