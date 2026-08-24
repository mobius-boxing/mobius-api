import { INodeType, INodeRunContext, INodeRunResult } from "./node-type";

/**
 * The trigger: where every graph starts, and the only node that takes no input
 * edge. It has no config — the extraction fields and the `requireReview` toggle
 * live on the workflow itself, not on a node — and its output is the document
 * the run is about, so downstream templates can say `{{nodes.<id>.documentName}}`
 * without knowing how the run began.
 */
export const triggerNode: INodeType = {
  type: "trigger",
  label: "Disparador",
  description:
    "Se activa cuando se sube un documento y termina la extracción de campos.",
  handles: ["out"],
  acceptsInput: false,
  configSchema: [],

  validate(): void {
    // Nothing to validate: an empty config is the only valid config, and any
    // extra key is ignored rather than refused, so a canvas that stores UI
    // state on the node does not break the save.
  },

  credentialRefs(): string[] {
    return [];
  },

  run(ctx: INodeRunContext): Promise<INodeRunResult> {
    return Promise.resolve({
      output: {
        documentName: ctx.document.name,
        contentType: ctx.document.contentType,
        fields: ctx.fields,
      },
      handle: "out",
    });
  },
};
