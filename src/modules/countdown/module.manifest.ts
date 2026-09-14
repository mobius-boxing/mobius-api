import type { ModuleManifest } from "../module.types";

/** Values as seeded by `20260812000002_seed_countdown_module`. */
export const countdownManifest: ModuleManifest = {
  slug: "countdown",
  name: "Countdown",
  description:
    "Seguimiento de vencimientos de documentos: alta con fecha de vencimiento, tablero de pendientes y vencidos, recordatorios por email y exportación a Excel.",
  isCore: false,
  plane: "tenant",
  userReferences: [],
};
