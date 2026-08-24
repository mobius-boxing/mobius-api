/**
 * The node registry contract.
 *
 * `GET /node-types` is what makes "adding a node type is a backend file and
 * nothing else" true: the editor generates its config panel from these
 * descriptors. A node type that ships without a renderable schema quietly moves
 * work back into the frontend, so the shape is asserted here rather than
 * discovered there.
 */
import { describe, expect, it } from "@jest/globals";
import {
  NODE_FILES_CONFIG_INPUT_TYPES,
  NODE_FILES_HANDLES,
  NODE_FILES_NODE_TYPES,
} from "../../../../interfaces/node-files/node-files.interfaces";
import {
  getNodeType,
  nodeTypeDescriptors,
  nodeTypes,
} from "../../../../services/node-files/nodes/registry";

describe("registry", () => {
  it("publishes every declared node type exactly once", () => {
    const types = nodeTypes().map((node) => node.type);
    expect([...types].sort()).toEqual([...NODE_FILES_NODE_TYPES].sort());
    expect(new Set(types).size).toBe(types.length);
  });

  it("resolves a type by name and declines an unknown one", () => {
    expect(getNodeType("condition")?.label).toBe("Condición");
    expect(getNodeType("code")).toBeNull();
  });

  it("gives every node a renderable config schema", () => {
    for (const descriptor of nodeTypeDescriptors()) {
      expect(descriptor.label).not.toBe("");
      expect(descriptor.description).not.toBe("");
      expect(descriptor.handles.length).toBeGreaterThan(0);
      for (const handle of descriptor.handles) {
        expect(NODE_FILES_HANDLES).toContain(handle);
      }
      for (const input of descriptor.configSchema) {
        expect(NODE_FILES_CONFIG_INPUT_TYPES).toContain(input.input);
        expect(input.label).not.toBe("");
        expect(Array.isArray(input.options)).toBe(true);
        // A select with no options is an empty dropdown in the editor.
        if (input.input === "select") {
          expect(input.options.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps exactly one node that nothing can point at: the trigger", () => {
    const starters = nodeTypes().filter((node) => !node.acceptsInput);
    expect(starters.map((node) => node.type)).toEqual(["trigger"]);
  });

  it("gives the condition node two handles and everyone else one", () => {
    for (const node of nodeTypes()) {
      expect(node.handles).toEqual(
        node.type === "condition" ? ["true", "false"] : ["out"],
      );
    }
  });
});
