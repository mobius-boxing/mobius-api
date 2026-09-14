import { coreManifest } from "./core/module.manifest";
import { corePurgeHook } from "./core/purge.hook";
import { countdownManifest } from "./countdown/module.manifest";
import { countdownPurgeHook } from "./countdown/purge.hook";
import { nodeFilesManifest } from "./node-files/module.manifest";
import { nodeFilesPurgeHook } from "./node-files/purge.hook";
import type {
  DeclaredUserReference,
  ModuleManifest,
  PurgeHook,
} from "./module.types";

/** Imported eagerly: the compiled bundle has no directory to scan. */
export const MODULE_MANIFESTS: readonly ModuleManifest[] = [
  coreManifest,
  countdownManifest,
  nodeFilesManifest,
];

/** In the order `purgeCompany` runs them. */
export const PURGE_HOOKS: readonly PurgeHook[] = [
  corePurgeHook,
  countdownPurgeHook,
  nodeFilesPurgeHook,
];

export const declaredUserReferences = (): DeclaredUserReference[] =>
  MODULE_MANIFESTS.flatMap((manifest) => manifest.userReferences);
