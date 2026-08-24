import {
  INodeFilesDefinition,
  INodeFilesDefinitionEdge,
  INodeFilesDefinitionNode,
  INodeFilesField,
  NODE_FILES_HANDLES,
  NodeFilesHandle,
} from "../../interfaces/node-files/node-files.interfaces";
import { getNodeType, isKnownNodeType } from "./nodes/registry";
import { NodeConfigError } from "./nodes/node-type";

/**
 * The workflow definition: parsing, validation and the execution plan.
 *
 * Validation happens when a definition is SAVED, not when it runs. Every rule
 * below exists because breaking it produces a run that fails halfway with side
 * effects already sent — an email delivered, an HTTP call made — and no amount
 * of care at run time can un-send those.
 *
 * The shape rules, and why each one:
 *
 *  - **Exactly one trigger.** Zero has no entry point; two means two runs of
 *    the same graph over one document, which is not what anybody drew.
 *  - **At most one outgoing edge per handle, and at most one incoming edge per
 *    node.** Fan-out and joins are explicit non-goals of Phase 2. Enforcing it
 *    here is what lets the executor be a walk instead of a scheduler, and it
 *    keeps "one `nf_node_runs` row per node" exactly true.
 *  - **No cycles.** Kahn's algorithm, so a cycle is refused at save time
 *    rather than discovered by a worker looping until the lock cap.
 *  - **Every node reachable from the trigger.** An orphan node would neither
 *    run nor be skipped, and the run detail would be missing a row with no
 *    explanation. A node that should not run is a `skipped` branch, not a
 *    floating rectangle.
 *  - **Config valid against its node type's schema**, delegated to the type.
 */

/** A definition rejected at save time; the controller answers 400. */
export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DefinitionError";
  }
}

/** Upper bounds. Not CHECK constraints (house rule) — these are the constraint. */
export const MAX_NODES = 40;
export const MAX_EDGES = 60;

const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DefinitionError(message);
  }
  return value as Record<string, unknown>;
};

const asNumber = (value: unknown, label: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DefinitionError(`${label} debe ser un número`);
  }
  return parsed;
};

/**
 * Shape-parse a definition off the wire. Structure only — node configs are
 * checked afterwards, by the node types themselves.
 */
export function parseDefinition(raw: unknown): INodeFilesDefinition {
  const source = asRecord(raw, "La definición del flujo es inválida");

  if (!Array.isArray(source.nodes)) {
    throw new DefinitionError("La definición debe incluir una lista de nodos");
  }
  if (!Array.isArray(source.edges)) {
    throw new DefinitionError(
      "La definición debe incluir una lista de conexiones",
    );
  }
  if (source.nodes.length === 0) {
    throw new DefinitionError("El flujo debe tener al menos un nodo");
  }
  if (source.nodes.length > MAX_NODES) {
    throw new DefinitionError(`Máximo ${MAX_NODES} nodos por flujo`);
  }
  if (source.edges.length > MAX_EDGES) {
    throw new DefinitionError(`Máximo ${MAX_EDGES} conexiones por flujo`);
  }

  const seenIds = new Set<string>();
  const nodes: INodeFilesDefinitionNode[] = source.nodes.map((raw, index) => {
    const node = asRecord(raw, `El nodo ${index + 1} es inválido`);
    // `nodeId`, never `id`: `sanitizeResponse` deletes every `id` key from
    // every response body, so a graph keyed by `id` would come back from the
    // API with anonymous nodes. See the interface for the full note.
    const id = String(node.nodeId ?? "");
    if (!NODE_ID_PATTERN.test(id)) {
      throw new DefinitionError(`Identificador de nodo inválido: "${id}"`);
    }
    if (seenIds.has(id)) {
      throw new DefinitionError(`Identificador de nodo repetido: "${id}"`);
    }
    seenIds.add(id);

    const type = String(node.type ?? "");
    if (!isKnownNodeType(type)) {
      throw new DefinitionError(`Tipo de nodo desconocido: "${type}"`);
    }

    const position = asRecord(
      node.position ?? { x: 0, y: 0 },
      `La posición del nodo "${id}" es inválida`,
    );

    return {
      nodeId: id,
      type,
      config: asRecord(
        node.config ?? {},
        `La configuración del nodo "${id}" es inválida`,
      ),
      position: {
        x: asNumber(position.x ?? 0, `La posición X del nodo "${id}"`),
        y: asNumber(position.y ?? 0, `La posición Y del nodo "${id}"`),
      },
    };
  });

  const seenEdgeIds = new Set<string>();
  const edges: INodeFilesDefinitionEdge[] = source.edges.map((raw, index) => {
    const edge = asRecord(raw, `La conexión ${index + 1} es inválida`);
    const id = String(edge.edgeId ?? "");
    if (!NODE_ID_PATTERN.test(id)) {
      throw new DefinitionError(`Identificador de conexión inválido: "${id}"`);
    }
    if (seenEdgeIds.has(id)) {
      throw new DefinitionError(`Identificador de conexión repetido: "${id}"`);
    }
    seenEdgeIds.add(id);

    const handleRaw = edge.sourceHandle;
    const handle =
      handleRaw === undefined || handleRaw === null || handleRaw === ""
        ? "out"
        : String(handleRaw);
    if (!(NODE_FILES_HANDLES as readonly string[]).includes(handle)) {
      throw new DefinitionError(`Salida de conexión inválida: "${handle}"`);
    }

    return {
      edgeId: id,
      source: String(edge.source ?? ""),
      target: String(edge.target ?? ""),
      sourceHandle: handle as NodeFilesHandle,
    };
  });

  return { nodes, edges };
}

export interface IValidatedDefinition {
  definition: INodeFilesDefinition;
  /** Static topological order — what the executor walks. */
  order: string[];
  /** Credential uuids referenced by any node, deduplicated. */
  credentialUuids: string[];
}

/**
 * Full validation. Throws `DefinitionError` with a sentence the editor can
 * show verbatim.
 */
export function validateDefinition(
  definition: INodeFilesDefinition,
  fields: INodeFilesField[],
): IValidatedDefinition {
  const byId = new Map(definition.nodes.map((node) => [node.nodeId, node]));

  const triggers = definition.nodes.filter((node) => node.type === "trigger");
  if (triggers.length === 0) {
    throw new DefinitionError("El flujo necesita un nodo disparador");
  }
  if (triggers.length > 1) {
    throw new DefinitionError("El flujo solo puede tener un nodo disparador");
  }
  const trigger = triggers[0] as INodeFilesDefinitionNode;

  // ---- edges -------------------------------------------------------------
  const outgoing = new Map<string, INodeFilesDefinitionEdge[]>();
  const incoming = new Map<string, INodeFilesDefinitionEdge[]>();

  for (const edge of definition.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source) {
      throw new DefinitionError(
        `La conexión "${edge.edgeId}" sale de un nodo que no existe`,
      );
    }
    if (!target) {
      throw new DefinitionError(
        `La conexión "${edge.edgeId}" llega a un nodo que no existe`,
      );
    }
    if (edge.source === edge.target) {
      throw new DefinitionError(
        `El nodo "${edge.source}" no puede conectarse a sí mismo`,
      );
    }

    const type = getNodeType(source.type);
    if (type && !type.handles.includes(edge.sourceHandle)) {
      throw new DefinitionError(
        `El nodo "${source.nodeId}" no tiene una salida "${edge.sourceHandle}"`,
      );
    }
    const targetType = getNodeType(target.type);
    if (targetType && !targetType.acceptsInput) {
      throw new DefinitionError(
        `Nada puede conectarse al nodo "${target.nodeId}" (${targetType.label})`,
      );
    }

    const fromSource = outgoing.get(edge.source) ?? [];
    if (fromSource.some((other) => other.sourceHandle === edge.sourceHandle)) {
      throw new DefinitionError(
        `El nodo "${source.nodeId}" ya tiene una conexión desde la salida "${edge.sourceHandle}"`,
      );
    }
    fromSource.push(edge);
    outgoing.set(edge.source, fromSource);

    const toTarget = incoming.get(edge.target) ?? [];
    if (toTarget.length > 0) {
      throw new DefinitionError(
        `El nodo "${target.nodeId}" ya recibe una conexión: no se admiten uniones`,
      );
    }
    toTarget.push(edge);
    incoming.set(edge.target, toTarget);
  }

  // ---- acyclicity, by Kahn -----------------------------------------------
  const indegree = new Map<string, number>();
  for (const node of definition.nodes) {
    indegree.set(node.nodeId, (incoming.get(node.nodeId) ?? []).length);
  }
  const queue = definition.nodes
    .filter((node) => (indegree.get(node.nodeId) ?? 0) === 0)
    .map((node) => node.nodeId);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, remaining);
      if (remaining === 0) queue.push(edge.target);
    }
  }
  if (order.length !== definition.nodes.length) {
    throw new DefinitionError(
      "El flujo tiene un ciclo: las conexiones no pueden volver atrás",
    );
  }

  // ---- reachability ------------------------------------------------------
  const reachable = new Set<string>([trigger.nodeId]);
  const pending = [trigger.nodeId];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const edge of outgoing.get(id) ?? []) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      pending.push(edge.target);
    }
  }
  const orphans = definition.nodes.filter(
    (node) => !reachable.has(node.nodeId),
  );
  if (orphans.length > 0) {
    throw new DefinitionError(
      `Hay nodos sin conectar al disparador: ${orphans
        .map((node) => node.nodeId)
        .join(", ")}`,
    );
  }

  // ---- per-node config ---------------------------------------------------
  const credentialUuids = new Set<string>();
  for (const node of definition.nodes) {
    const type = getNodeType(node.type);
    if (!type) {
      throw new DefinitionError(`Tipo de nodo desconocido: "${node.type}"`);
    }
    try {
      type.validate(node.config, { fields });
    } catch (err) {
      if (err instanceof NodeConfigError) {
        throw new DefinitionError(`Nodo "${node.nodeId}": ${err.message}`);
      }
      throw err;
    }
    for (const uuid of type.credentialRefs(node.config)) {
      credentialUuids.add(uuid);
    }
  }

  return {
    definition,
    // The trigger first, then the rest in topological order — `order` already
    // is topological, and the trigger is its only source node.
    order,
    credentialUuids: [...credentialUuids],
  };
}

/** The one outgoing edge of a handle, if the graph draws one. */
export function nextNodeId(
  definition: INodeFilesDefinition,
  nodeId: string,
  handle: NodeFilesHandle,
): string | null {
  const edge = definition.edges.find(
    (candidate) =>
      candidate.source === nodeId && candidate.sourceHandle === handle,
  );
  return edge ? edge.target : null;
}

/** The trigger of an already-validated definition. */
export function triggerNodeOf(
  definition: INodeFilesDefinition,
): INodeFilesDefinitionNode | null {
  return definition.nodes.find((node) => node.type === "trigger") ?? null;
}
