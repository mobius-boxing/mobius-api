import { Lane } from "./geometry";

/**
 * Cutting stations ("mesas") — port of Mesificador.cs, Grafo.cs,
 * Combinacion.ObtenerMesas/SepararPorLargo/DividirSobrantes and Mesa.cs.
 * Tier 1 has no dimension tolerance, so Item.LargosCompatibles is plain
 * equality of run lengths.
 */

/**
 * Mesificador.Mesificar: colour the "different run length" conflict graph with
 * Grafo's backtracking and reorder lanes by colour (stable). Grafo.Continuar
 * never backtracks here (a vertex can always take a fresh colour), so it is
 * first-fit colouring in lane order; with equality conflicts the colour
 * classes are exactly the distinct run lengths in first-appearance order.
 */
export function mesificar(lanes: Lane[]): Lane[] {
  const lengths: number[] = [];
  for (const l of lanes)
    if (!lengths.includes(l.runLength)) lengths.push(l.runLength);
  const out: Lane[] = [];
  for (const len of lengths)
    for (const l of lanes) if (l.runLength === len) out.push(l);
  return out;
}

/**
 * Combinacion.ObtenerMesas: SepararPorLargo over the (mesificado) lane order,
 * then DividirSobrantes — while fewer stations than `maxTables` and one is
 * shared, the first shared station gives its first lane a station of its own.
 * `maxTables` = Infinity for a machine without a station limit (D-28).
 */
export function obtenerMesas(lanes: Lane[], maxTables: number): Lane[][] {
  const mesas: Lane[][] = [];
  let current: Lane[] | null = null;
  for (const lane of lanes) {
    if (
      current === null ||
      !current.every((l) => l.runLength === lane.runLength)
    ) {
      current = [];
      mesas.push(current);
    }
    current.push(lane);
  }
  while (mesas.length < maxTables && mesas.some((m) => m.length > 1)) {
    const index = mesas.findIndex((m) => m.length > 1);
    const shared = mesas[index];
    mesas.splice(index, 1, [shared[0]], shared.slice(1));
  }
  return mesas;
}

/** Mesa.Formatos — distinct lane widths in the station. */
export const formatsOf = (mesa: Lane[]): number =>
  new Set(mesa.map((l) => l.runWidth)).size;

/** Mesa.Pedidos — distinct orders in the station. */
export const ordersOf = (mesa: Lane[]): number =>
  new Set(mesa.map((l) => l.orderKey)).size;

/** Combinacion.FormatosMaximos. */
export const maxFormatsPerTable = (mesas: Lane[][]): number =>
  mesas.length ? Math.max(...mesas.map(formatsOf)) : 0;

/** Combinacion.PedidosMaximos. */
export const maxOrdersPerTable = (mesas: Lane[][]): number =>
  mesas.length ? Math.max(...mesas.map(ordersOf)) : 0;

/** Combinacion.PedidosPorFormatoMaximos — lanes (Items, not sheets) sharing a width. */
export function maxOrdersPerFormat(lanes: Lane[]): number {
  const widths = Array.from(new Set(lanes.map((l) => l.runWidth)));
  return widths.length
    ? Math.max(
        ...widths.map((w) => lanes.filter((l) => l.runWidth === w).length),
      )
    : 0;
}

/** A machine limit of 0 means "no limit" (D-28). */
export const limitOrInfinity = (limit: number): number =>
  limit > 0 ? limit : Infinity;
