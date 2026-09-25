import { castInt } from "./rounding";
import {
  Lane,
  dimensionsConsistent,
  elementsOf,
  scoreLinesOf,
  toLane,
  trimOf,
} from "./geometry";
import {
  limitOrInfinity,
  maxFormatsPerTable,
  maxOrdersPerFormat,
  maxOrdersPerTable,
  mesificar,
  obtenerMesas,
} from "./mesas";
import {
  Candidate,
  EngineInput,
  EngineMachine,
  EnumerationResult,
} from "./types";

/**
 * Candidate enumeration — port of Combinador.Generar/Imposible/Factible
 * (Combinador.cs:125-420) for the plant's tier-1 configuration:
 * IgnorarCorrugados (no materials), no dimension tolerance, no length
 * replication, RepeticionesMaximas off.
 */

/** Past this many candidates the MIP would exceed the embedded solver's size gate anyway (C-6, D-41). */
export const MAX_CANDIDATES = 20000;

const DEADLINE_CHECK_EVERY = 2048;

/** Ambiente.*Maximos over the offered machines; any unlimited machine makes the family unlimited (D-28). */
function environmentMaxima(machines: EngineMachine[]) {
  const maxOf = (pick: (m: EngineMachine) => number) =>
    machines.some((m) => pick(m) <= 0)
      ? Infinity
      : Math.max(...machines.map(pick));
  return {
    width: Math.max(...machines.map((m) => m.width)),
    elements: maxOf((m) => m.maxElements),
    tables: maxOf((m) => m.tableCount),
    formatsPerTable: maxOf((m) => m.formatsPerTable),
    ordersPerFormat: maxOf((m) => m.ordersPerFormat),
    ordersPerTable: maxOf((m) => m.ordersPerTable),
    scoreLines: maxOf((m) => m.maxScoreLines),
  };
}

/**
 * Physical rules of Factible for machine `m` (everything except the scrap
 * limits), in C# order. Returns the failing rule name or null. `lanes` must be
 * in mesificado order.
 */
export function physicalRule(lanes: Lane[], m: EngineMachine): string | null {
  const trim = trimOf(lanes);
  if (trim > m.width - m.trim) return "trim-exceeds-width";
  if (m.maxElements > 0 && elementsOf(lanes) > m.maxElements) return "elements";
  const mesas = obtenerMesas(lanes, limitOrInfinity(m.tableCount));
  if (m.tableCount > 0 && mesas.length > m.tableCount) return "tables";
  if (m.formatsPerTable > 0 && maxFormatsPerTable(mesas) > m.formatsPerTable)
    return "formats-per-table";
  if (m.ordersPerFormat > 0 && maxOrdersPerFormat(lanes) > m.ordersPerFormat)
    return "orders-per-format";
  if (m.ordersPerTable > 0 && maxOrdersPerTable(mesas) > m.ordersPerTable)
    return "orders-per-table";
  if (m.maxScoreLines > 0 && scoreLinesOf(lanes) > m.maxScoreLines)
    return "score-lines";
  if (lanes.some((l) => l.runLength < m.sheetLengthMin))
    return "sheet-length-min";
  if (m.sheetLengthMax > 0 && lanes.some((l) => l.runLength > m.sheetLengthMax))
    return "sheet-length-max";
  return null;
}

/**
 * Combinador.Factible with Corrugadora still null on the combination
 * (Combinador.cs:256-260): the refile % here ignores the machine trim.
 */
export function factibleRule(
  input: EngineInput,
  lanes: Lane[],
  m: EngineMachine,
): string | null {
  const trim = trimOf(lanes);
  const refileNoMachine = 100 - (m.width > 0 ? (100 * trim) / m.width : 100);
  if (refileNoMachine > input.parameters.scrapPercentage)
    return "scrap-percentage";
  if (m.width - m.trim - trim > input.parameters.scrapAbsolute) return "scrap-absolute";
  return physicalRule(lanes, m);
}

export function enumerate(
  input: EngineInput,
  deadlineMs?: number,
): EnumerationResult {
  const started = Date.now();
  const deadline = deadlineMs === undefined ? Infinity : started + deadlineMs;
  const result = (
    status: EnumerationResult["status"],
    candidates: Candidate[],
    reason?: string,
  ): EnumerationResult => ({
    status,
    candidates,
    generated: candidates.length,
    elapsedMs: Date.now() - started,
    reason,
  });

  if (input.machines.length === 0 || input.orders.length === 0)
    return result("no-combinations", []);

  const env = environmentMaxima(input.machines);
  const limit = input.parameters.limitCombinations;

  // Combinador.GenerarItems: per order, the unrotated item, then the rotated one.
  const items: Lane[] = [];
  for (const order of input.orders) {
    if (order.sheetLength <= 0 || order.sheetWidth <= 0) continue;
    items.push(toLane(order, 1, false));
    if (order.allowsRotation && input.parameters.rotation)
      items.push(toLane(order, 1, true));
  }

  const candidates: Candidate[] = [];
  let stop: { status: EnumerationResult["status"]; reason: string } | null =
    null;
  let visited = 0;
  let work: Lane[] = [];

  const imposible = (lanes: Lane[]): boolean => {
    if (trimOf(lanes) > env.width) return true;
    if (elementsOf(lanes) > env.elements) return true;
    const mesas = obtenerMesas(lanes, env.tables);
    if (mesas.length > env.tables) return true;
    if (maxFormatsPerTable(mesas) > env.formatsPerTable) return true;
    if (maxOrdersPerFormat(lanes) > env.ordersPerFormat) return true;
    if (maxOrdersPerTable(mesas) > env.ordersPerTable) return true;
    if (scoreLinesOf(lanes) > env.scoreLines) return true;
    return !dimensionsConsistent(lanes);
  };

  const generar = (desde: number): void => {
    if (stop || desde === items.length) return;
    if (limit > 0 && candidates.length > limit) return;
    if (++visited % DEADLINE_CHECK_EVERY === 0 && Date.now() > deadline) {
      stop = {
        status: "too-many-combinations",
        reason: "enumeration exceeded the time limit",
      };
      return;
    }
    generar(desde + 1);
    const item = items[desde];
    const aparicionesMaximas =
      item.runWidth > 0
        ? castInt((env.width - trimOf(work)) / item.runWidth)
        : 0;
    for (let i = 1; i <= aparicionesMaximas && !stop; i++) {
      const added: Lane = { ...item, count: i };
      work = mesificar([...work, added]);
      if (!imposible(work)) {
        for (const m of input.machines) {
          if (factibleRule(input, work, m) === null) {
            candidates.push({
              machineKey: m.key,
              items: work.map((l) => ({
                orderKey: l.orderKey,
                count: l.count,
                rotated: l.rotated,
              })),
            });
            if (candidates.length > MAX_CANDIDATES) {
              stop = {
                status: "too-many-combinations",
                reason: `more than ${MAX_CANDIDATES} combinations; tighten the machine limits or the scrap limits`,
              };
              return;
            }
          }
        }
        generar(desde + 1);
      }
      work = work.filter((l) => l !== added);
    }
  };

  generar(0);

  if (stop !== null) {
    const s = stop as { status: EnumerationResult["status"]; reason: string };
    return result(s.status, [], s.reason);
  }
  if (limit > 0 && candidates.length >= limit) {
    return result(
      "too-many-combinations",
      [],
      `limitCombinations ${limit} reached`,
    );
  }
  if (candidates.length === 0) return result("no-combinations", []);
  return result("ok", candidates);
}
