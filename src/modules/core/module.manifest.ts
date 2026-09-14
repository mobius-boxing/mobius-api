import type { ModuleManifest } from "../module.types";

/** Values as seeded by `20260520000003_seed_modules_and_backfill_core_links`. */
export const coreManifest: ModuleManifest = {
  slug: "core",
  name: "Core",
  description: "Main Mobius application — always enabled for every company.",
  isCore: true,
  plane: "tenant",
  userReferences: [],
};
