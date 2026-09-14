import type { ModuleManifest } from "../module.types";

/** Values as seeded by `20260824000003_seed_node_files_module`. */
export const nodeFilesManifest: ModuleManifest = {
  slug: "node-files",
  name: "Node Files",
  description:
    "Extracción de datos de documentos con IA: definí un flujo con los campos a extraer, subí el documento y revisá los valores obtenidos.",
  isCore: false,
  plane: "tenant",
  // The node-files tables were built without foreign keys to central tables
  // (amendment-2026-08-24), so these user columns exist only here.
  // `nf_runs.lockedBy` is not one of them: it holds the worker's process claim
  // id (`20260824000002_create_node_files_tables`), not a user.
  userReferences: [
    { table: "nf_credentials", column: "createdByUserId", nullable: true },
    { table: "nf_workflows", column: "createdByUserId", nullable: true },
    { table: "nf_documents", column: "uploadedByUserId", nullable: true },
    { table: "nf_runs", column: "reviewedByUserId", nullable: true },
  ],
};
