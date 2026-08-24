import { randomUUID } from "crypto";
import { NfCredentialDAO } from "../../dao/node-files/nf-credential.dao";
import { NfDocumentDAO } from "../../dao/node-files/nf-document.dao";
import { NfNodeRunDAO } from "../../dao/node-files/nf-node-run.dao";
import { NfRunDAO } from "../../dao/node-files/nf-run.dao";
import { NfWorkflowDAO } from "../../dao/node-files/nf-workflow.dao";
import {
  INodeFilesClaimedRun,
  INodeFilesDefinition,
  INodeFilesDefinitionNode,
  INodeFilesExtractedValue,
  NodeFilesExtractedValues,
  NodeFilesHandle,
  NodeFilesNodeRunStatus,
} from "../../interfaces/node-files/node-files.interfaces";
import { decryptSecret, NodeFilesSecretError } from "./credential-crypto";
import {
  nextNodeId,
  parseDefinition,
  triggerNodeOf,
  validateDefinition,
} from "./definition";
import {
  INodeCredential,
  INodeRunContext,
  NodeExecutionError,
} from "./nodes/node-type";
import { getNodeType } from "./nodes/registry";

/**
 * The DAG executor: walk a validated definition, one `nf_node_runs` row per
 * node, first failure fails the run.
 *
 * **The connection rule, which is the hardest constraint in this module and
 * gets harder here.** The `nodefiles` pool has 5 connections and a node makes
 * real network calls — an HTTP request that hangs for its full timeout, an
 * email that waits on a provider. A connection held across one of those starves
 * the module's entire HTTP surface. So the sequence is fixed and is visible in
 * the code below:
 *
 *   1. claim                — one statement (the worker, before we are called)
 *   2. load context         — a few short scoped SELECTs, then nothing held
 *   3. per node: `run()`    — ZERO connections held, however long it takes
 *   4. persist the node run — one short INSERT
 *   5. advance the run      — one short UPDATE at the end
 *
 * Steps 3 and 4 alternate; step 3 never overlaps a connection. Nothing here
 * opens a transaction: there is no multi-row write that needs one, and a
 * transaction spanning a node would be the exact bug this comment prevents.
 * (The rule is stated in three other files: `node-files-worker.ts:20-25`,
 * `nf-document.dao.ts:44-49`, `node-files.service.ts:176-179`.)
 */

/** Logs are a debugging aid, not a data store. */
const MAX_LOG_CHARS = 16_000;

const runDAO = new NfRunDAO();
const workflowDAO = new NfWorkflowDAO();
const documentDAO = new NfDocumentDAO();
const nodeRunDAO = new NfNodeRunDAO();
const credentialDAO = new NfCredentialDAO();

/** `{ key: { value, confidence } }` → `{ key: value }`, as templates see it. */
export function plainValues(
  values: NodeFilesExtractedValues | null,
): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(values ?? {})) {
    plain[key] = (entry as INodeFilesExtractedValue).value;
  }
  return plain;
}

/** The credentials a definition needs, decrypted once, before any node runs. */
async function loadCredentials(
  uuids: string[],
  companyId: number,
): Promise<{
  credentials: Map<string, INodeCredential>;
  failures: Map<string, string>;
}> {
  const credentials = new Map<string, INodeCredential>();
  const failures = new Map<string, string>();

  for (const uuid of uuids) {
    const row = await credentialDAO.getSecretByUuid(uuid, companyId);
    if (!row) {
      failures.set(uuid, "La credencial configurada ya no existe");
      continue;
    }
    try {
      const secret = decryptSecret({
        ciphertext: row.secretCiphertext,
        iv: row.secretIv,
        tag: row.secretTag,
      });
      credentials.set(uuid, {
        uuid: row.uuid,
        name: row.name,
        headerName:
          row.type === "bearer"
            ? "Authorization"
            : (row.headerName ?? "Authorization"),
        headerValue: row.type === "bearer" ? `Bearer ${secret}` : secret,
      });
    } catch (err) {
      // A missing NF_SECRET_KEY lands here, exactly as a missing
      // ANTHROPIC_API_KEY lands in one failed extraction: this run's HTTP node
      // fails with a sentence naming the cause, and nothing else is affected.
      failures.set(
        uuid,
        err instanceof NodeFilesSecretError
          ? err.message
          : "No se pudo descifrar la credencial",
      );
    }
  }
  return { credentials, failures };
}

interface INodeOutcome {
  status: NodeFilesNodeRunStatus;
  output: Record<string, unknown> | null;
  error: string | null;
  handle: NodeFilesHandle | null;
  logs: string[];
  durationMs: number;
}

/** Run one node with zero connections held. Never throws. */
async function runNode(
  node: INodeFilesDefinitionNode,
  ctxBase: Omit<INodeRunContext, "log">,
  credentialFailures: Map<string, string>,
): Promise<INodeOutcome> {
  const logs: string[] = [];
  const startedAt = Date.now();
  const type = getNodeType(node.type);

  if (!type) {
    return {
      status: "failed",
      output: null,
      error: `Tipo de nodo desconocido: ${node.type}`,
      handle: null,
      logs,
      durationMs: Date.now() - startedAt,
    };
  }

  // A credential that could not be decrypted fails the node with the crypto
  // message rather than the node's generic "no existe": the difference between
  // "you deleted it" and "the server has no key" is the whole diagnosis.
  for (const uuid of type.credentialRefs(node.config)) {
    const failure = credentialFailures.get(uuid);
    if (failure !== undefined) {
      return {
        status: "failed",
        output: null,
        error: failure,
        handle: null,
        logs,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  try {
    const result = await type.run(
      { ...ctxBase, log: (message: string) => logs.push(message) },
      node.config,
    );
    return {
      status: "succeeded",
      output: result.output,
      error: null,
      handle: result.handle,
      logs,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    // A NodeExecutionError's message is written for the tenant; anything else
    // is a bug or an outage and gets a generic message, with the detail logged.
    if (!(err instanceof NodeExecutionError)) {
      console.error(
        `[node-files] node ${node.nodeId} (${node.type}) failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    return {
      status: "failed",
      output: null,
      error:
        err instanceof NodeExecutionError
          ? err.message
          : "Error inesperado al ejecutar el nodo",
      handle: null,
      logs,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Execute one claimed run's node graph and advance the run.
 *
 * Called from exactly two places, which are the two hand-off points of brief
 * D-1: the worker straight after extraction (`requireReview: false`), and the
 * worker again after `POST /review` moved the run to `running` (
 * `requireReview: true`). Both arrive here holding a claim and no connection.
 */
export async function executeRun(claim: INodeFilesClaimedRun): Promise<void> {
  // ---- 2. load context, in short scoped queries --------------------------
  const [run, workflow] = await Promise.all([
    runDAO.getStatusById(claim.id, claim.companyId),
    workflowDAO.getById(claim.workflowId, claim.companyId),
  ]);
  if (!run) return;
  if (!workflow) {
    await runDAO.finishExecution(
      claim.id,
      claim.companyId,
      "failed",
      "El flujo ya no existe",
    );
    return;
  }

  const rawDefinition = workflow.definition as INodeFilesDefinition | null;
  if (!rawDefinition || rawDefinition.nodes.length === 0) {
    // A workflow that only extracts: nothing to walk, and the run is done.
    await runDAO.finishExecution(claim.id, claim.companyId, "succeeded", null);
    return;
  }

  let plan;
  try {
    plan = validateDefinition(parseDefinition(rawDefinition), workflow.fields);
  } catch (err) {
    await runDAO.finishExecution(
      claim.id,
      claim.companyId,
      "failed",
      err instanceof Error
        ? `La definición del flujo es inválida: ${err.message}`
        : "La definición del flujo es inválida",
    );
    return;
  }

  const document = await documentDAO.getById(claim.documentId, claim.companyId);
  const { credentials, failures } = await loadCredentials(
    plan.credentialUuids,
    claim.companyId,
  );
  const attempt = (await nodeRunDAO.maxAttempt(claim.id, claim.companyId)) + 1;

  const fields = plainValues(run.reviewedValues ?? run.extracted);
  const fieldTypes: Record<string, string> = {};
  for (const field of workflow.fields) fieldTypes[field.key] = field.type;

  const definition = plan.definition;
  const trigger = triggerNodeOf(definition);
  const byId = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  const nodeOutputs: Record<string, Record<string, unknown>> = {};

  // ---- 3/4. one node at a time, no connection held while it runs ---------
  let current: string | null = trigger ? trigger.nodeId : null;
  let failure: string | null = null;
  const usedCredentials = new Set<string>();

  for (const nodeId of plan.order) {
    const node = byId.get(nodeId) as INodeFilesDefinitionNode;

    // Not on the path the conditions chose — or after the failure that ended
    // the run. Either way the row says `skipped`, so the timeline has one row
    // per node and no gaps to explain.
    if (nodeId !== current) {
      await nodeRunDAO.create({
        uuid: randomUUID(),
        runId: claim.id,
        companyId: claim.companyId,
        nodeId: node.nodeId,
        nodeType: node.type,
        status: "skipped",
        input: null,
        output: null,
        logs: null,
        error: null,
        durationMs: null,
        attempt,
      });
      continue;
    }

    const outcome = await runNode(
      node,
      {
        document: {
          name: document?.originalName ?? "",
          contentType: document?.contentType ?? "",
        },
        fields,
        fieldTypes,
        nodes: nodeOutputs,
        credentials,
      },
      failures,
    );

    await nodeRunDAO.create({
      uuid: randomUUID(),
      runId: claim.id,
      companyId: claim.companyId,
      nodeId: node.nodeId,
      nodeType: node.type,
      status: outcome.status,
      input: { config: node.config },
      output: outcome.output,
      logs:
        outcome.logs.length === 0
          ? null
          : outcome.logs.join("\n").slice(0, MAX_LOG_CHARS),
      error: outcome.error,
      durationMs: outcome.durationMs,
      attempt,
    });

    if (outcome.status === "failed") {
      // First failure fails the run; every node after it is `skipped`.
      failure = outcome.error ?? "Falló un nodo del flujo";
      current = null;
      continue;
    }

    const nodeType = getNodeType(node.type);
    for (const uuid of nodeType?.credentialRefs(node.config) ?? []) {
      usedCredentials.add(uuid);
    }
    nodeOutputs[node.nodeId] = outcome.output ?? {};
    current = nextNodeId(definition, node.nodeId, outcome.handle ?? "out");
  }

  // Bookkeeping, after the walk and in its own statements — never on the path
  // of a node's execution.
  for (const uuid of usedCredentials) {
    await credentialDAO
      .touchLastUsed(uuid, claim.companyId)
      .catch((err: unknown) => {
        console.error(
          `[node-files] could not stamp credential ${uuid}:`,
          err instanceof Error ? err.message : err,
        );
      });
  }

  // ---- 5. advance the run, one short statement ---------------------------
  await runDAO.finishExecution(
    claim.id,
    claim.companyId,
    failure === null ? "succeeded" : "failed",
    failure,
  );
  console.info(
    `[node-files] run ${claim.uuid} ${failure === null ? "succeeded" : "failed"} ` +
      `after ${plan.order.length} node(s)`,
  );
}
