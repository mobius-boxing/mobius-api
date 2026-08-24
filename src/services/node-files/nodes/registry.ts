import {
  INodeFilesNodeTypeDescriptor,
  NodeFilesNodeType,
} from "../../../interfaces/node-files/node-files.interfaces";
import { conditionNode } from "./condition.node";
import { emailNode } from "./email.node";
import { httpNode } from "./http.node";
import { INodeType, toDescriptor } from "./node-type";
import { triggerNode } from "./trigger.node";

/**
 * The node registry — an array of node types and a factory that resolves one by
 * name, the same shape `resolveExtractionSettings` + `ClaudeExtractionProvider`
 * give the extraction side.
 *
 * Adding a node type is: write the file, add it here. The editor needs no new
 * component, because `GET /node-types` publishes the config schema and the
 * panel is generated from it; the validator needs no new case, because it calls
 * `validate`; the executor needs no new case, because it calls `run`.
 */
const REGISTRY: INodeType[] = [triggerNode, conditionNode, emailNode, httpNode];

/** Every node type, in the order the editor should list them. */
export function nodeTypes(): INodeType[] {
  return REGISTRY;
}

/** The factory. `null` for an unknown type — callers turn that into a 400. */
export function getNodeType(type: string): INodeType | null {
  return REGISTRY.find((node) => node.type === type) ?? null;
}

export function isKnownNodeType(type: string): type is NodeFilesNodeType {
  return getNodeType(type) !== null;
}

/** The wire shape of `GET /node-types`. */
export function nodeTypeDescriptors(): INodeFilesNodeTypeDescriptor[] {
  return REGISTRY.map(toDescriptor);
}
