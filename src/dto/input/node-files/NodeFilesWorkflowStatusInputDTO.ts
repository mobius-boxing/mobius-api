import { NodeFilesWorkflowStatus } from "../../../interfaces/node-files/node-files.interfaces";
import { parseWorkflowStatus } from "./NodeFilesWorkflowCreateInputDTO";

/**
 * `POST /workflows/:uuid/status` — publishing or retiring a flow, which is a
 * verb of its own rather than a PATCH field: "activar" is a decision with
 * consequences (an active flow accepts uploads), and it reads as one in the
 * audit log.
 */
export class NodeFilesWorkflowStatusInputDTO {
  status: NodeFilesWorkflowStatus;

  constructor(data: Record<string, unknown>) {
    const source = data ?? {};
    const status = parseWorkflowStatus(source.status);
    if (status === undefined) {
      throw new Error("Indicá el estado del flujo");
    }
    this.status = status;
  }

  public build(): this {
    return this;
  }
}
