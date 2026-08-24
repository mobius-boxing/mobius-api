/**
 * Definition validation — every rule here exists because breaking it produces a
 * run that fails halfway with side effects already sent. A save-time 400 is
 * cheap; an email that went out before the graph turned out to be a cycle is not.
 */
import { describe, expect, it } from "@jest/globals";
import {
  DefinitionError,
  MAX_NODES,
  parseDefinition,
  validateDefinition,
} from "../../../../services/node-files/definition";
import {
  INodeFilesDefinition,
  INodeFilesField,
} from "../../../../interfaces/node-files/node-files.interfaces";

const FIELDS: INodeFilesField[] = [
  {
    key: "total",
    label: "Total",
    type: "currency",
    description: null,
    required: true,
  },
];

const node = (
  nodeId: string,
  type: string,
  config: Record<string, unknown> = {},
): Record<string, unknown> => ({
  nodeId,
  type,
  config,
  position: { x: 0, y: 0 },
});

const edge = (
  edgeId: string,
  source: string,
  target: string,
  sourceHandle?: string,
): Record<string, unknown> => ({ edgeId, source, target, sourceHandle });

const EMAIL = {
  to: "compras@empresa.com",
  subject: "Factura {{fields.total}}",
  body: "Total: {{fields.total}}",
};

const HTTP = {
  method: "POST",
  url: "https://api.ejemplo.com/facturas",
  body: '{"total":"{{fields.total}}"}',
};

/** The AC-3 graph: trigger → condition → email(true) / http(false). */
const branching = (): INodeFilesDefinition =>
  parseDefinition({
    nodes: [
      node("t1", "trigger"),
      node("c1", "condition", { left: "total", op: "gt", right: "1000" }),
      node("e1", "email", EMAIL),
      node("h1", "http", HTTP),
    ],
    edges: [
      edge("x1", "t1", "c1"),
      edge("x2", "c1", "e1", "true"),
      edge("x3", "c1", "h1", "false"),
    ],
  });

const validating =
  (definition: INodeFilesDefinition): (() => unknown) =>
  (): unknown =>
    validateDefinition(definition, FIELDS);

describe("parseDefinition", () => {
  it("defaults an absent handle to `out` and keeps canvas positions", () => {
    const parsed = parseDefinition({
      nodes: [{ nodeId: "t1", type: "trigger", position: { x: 12, y: -4 } }],
      edges: [],
    });
    expect(parsed.nodes[0]?.position).toEqual({ x: 12, y: -4 });
    expect(parsed.nodes[0]?.config).toEqual({});
  });

  it("keys nodes and edges by `nodeId`/`edgeId`, never `id`", () => {
    // `sanitizeResponse` deletes every `id` key from every response body, at
    // any depth. A definition that stored `id` would come back from the API
    // with anonymous nodes and an uneditable canvas — this assertion is the
    // guard against someone "fixing" the naming back.
    const parsed = parseDefinition({
      nodes: [node("t1", "trigger"), node("e1", "email", EMAIL)],
      edges: [edge("x1", "t1", "e1")],
    });
    expect(Object.keys(parsed.nodes[0] ?? {})).not.toContain("id");
    expect(Object.keys(parsed.edges[0] ?? {})).not.toContain("id");
    expect(parsed.nodes[0]?.nodeId).toBe("t1");
    expect(parsed.edges[0]?.edgeId).toBe("x1");
  });

  it("refuses an unknown node type rather than storing it for later", () => {
    expect(() =>
      parseDefinition({ nodes: [node("c1", "code")], edges: [] }),
    ).toThrow(DefinitionError);
  });

  it("refuses duplicate node ids — two nodes that collapse into one row", () => {
    expect(() =>
      parseDefinition({
        nodes: [node("t1", "trigger"), node("t1", "email", EMAIL)],
        edges: [],
      }),
    ).toThrow(/repetido/);
  });

  it("caps the graph size", () => {
    const nodes = Array.from({ length: MAX_NODES + 1 }, (_unused, index) =>
      node(`n${index}`, "trigger"),
    );
    expect(() => parseDefinition({ nodes, edges: [] })).toThrow(
      new RegExp(`Máximo ${MAX_NODES} nodos`),
    );
  });
});

describe("validateDefinition", () => {
  it("accepts the branching graph and orders it topologically", () => {
    const plan = validateDefinition(branching(), FIELDS);
    expect(plan.order[0]).toBe("t1");
    expect(plan.order).toHaveLength(4);
    expect(plan.order.indexOf("c1")).toBeLessThan(plan.order.indexOf("e1"));
  });

  it("requires exactly one trigger", () => {
    expect(
      validating(
        parseDefinition({ nodes: [node("e1", "email", EMAIL)], edges: [] }),
      ),
    ).toThrow(/necesita un nodo disparador/);

    expect(
      validating(
        parseDefinition({
          nodes: [node("t1", "trigger"), node("t2", "trigger")],
          edges: [],
        }),
      ),
    ).toThrow(/un solo nodo disparador|solo puede tener un nodo disparador/);
  });

  it("refuses a cycle", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [
            node("t1", "trigger"),
            node("e1", "email", EMAIL),
            node("h1", "http", HTTP),
          ],
          edges: [
            edge("x1", "t1", "e1"),
            edge("x2", "e1", "h1"),
            // Back to a node that already ran: the run would never end.
            edge("x3", "h1", "e1"),
          ],
        }),
      ),
    ).toThrow(/ciclo|uniones/);
  });

  it("refuses a node that no path from the trigger can reach", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [node("t1", "trigger"), node("e1", "email", EMAIL)],
          edges: [],
        }),
      ),
    ).toThrow(/sin conectar al disparador/);
  });

  it("refuses fan-out from one handle and joins into one node", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [
            node("t1", "trigger"),
            node("e1", "email", EMAIL),
            node("h1", "http", HTTP),
          ],
          edges: [edge("x1", "t1", "e1"), edge("x2", "t1", "h1")],
        }),
      ),
    ).toThrow(/ya tiene una conexión desde la salida/);
  });

  it("refuses an edge INTO the trigger", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [node("t1", "trigger"), node("e1", "email", EMAIL)],
          edges: [edge("x1", "t1", "e1"), edge("x2", "e1", "t1")],
        }),
      ),
    ).toThrow(/Nada puede conectarse/);
  });

  it("refuses a `true` handle on a node that does not branch", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [node("t1", "trigger"), node("e1", "email", EMAIL)],
          edges: [edge("x1", "t1", "e1", "true")],
        }),
      ),
    ).toThrow(/no tiene una salida "true"/);
  });

  it("refuses a broken node config, naming the node", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [
            node("t1", "trigger"),
            node("e1", "email", { ...EMAIL, to: "no-es-un-email" }),
          ],
          edges: [edge("x1", "t1", "e1")],
        }),
      ),
    ).toThrow(/Nodo "e1"/);
  });

  it("refuses a template that references a field the flow does not declare", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [
            node("t1", "trigger"),
            node("e1", "email", { ...EMAIL, body: "Total: {{fields.totl}}" }),
          ],
          edges: [edge("x1", "t1", "e1")],
        }),
      ),
    ).toThrow(/no declara el campo "totl"/);
  });

  it("collects the credentials a graph references, deduplicated", () => {
    const plan = validateDefinition(
      parseDefinition({
        nodes: [
          node("t1", "trigger"),
          node("h1", "http", {
            ...HTTP,
            credentialUuid: "11111111-1111-4111-8111-111111111111",
          }),
          node("h2", "http", {
            ...HTTP,
            credentialUuid: "11111111-1111-4111-8111-111111111111",
          }),
        ],
        edges: [edge("x1", "t1", "h1"), edge("x2", "h1", "h2")],
      }),
      FIELDS,
    );
    expect(plan.credentialUuids).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("refuses a non-https URL at save time", () => {
    expect(
      validating(
        parseDefinition({
          nodes: [
            node("t1", "trigger"),
            node("h1", "http", { ...HTTP, url: "http://api.ejemplo.com/x" }),
          ],
          edges: [edge("x1", "t1", "h1")],
        }),
      ),
    ).toThrow(/https/);
  });
});
