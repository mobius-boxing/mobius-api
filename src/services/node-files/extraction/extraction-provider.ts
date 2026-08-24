import { AppConfigDAO } from "../../../dao/app-config/app-config.dao";
import {
  INodeFilesField,
  NodeFilesExtractedValues,
} from "../../../interfaces/node-files/node-files.interfaces";

/** What the worker hands the provider. Bytes are already out of storage. */
export interface IExtractionRequest {
  fields: INodeFilesField[];
  bytes: Buffer;
  contentType: string;
  originalName: string;
}

export interface IExtractionResult {
  values: NodeFilesExtractedValues;
  tokensIn: number;
  tokensOut: number;
}

/**
 * A run-fatal extraction problem whose message IS shown to the tenant, so it is
 * written in Spanish and carries no provider internals (never `stop_details`,
 * never a raw SDK payload).
 */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export interface IExtractionProvider {
  extract(request: IExtractionRequest): Promise<IExtractionResult>;
}

export type ExtractionEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface IExtractionSettings {
  model: string;
  effort: ExtractionEffort;
  maxTokens: number;
}

const EFFORT_VALUES: ExtractionEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Defaults, and the app_config keys that override them per company.
 *
 * Opus 5 is the default and is NOT to be swapped for something cheaper without
 * the owner's say-so; the point of reading it from app_config is that such a
 * decision needs a row, not a deploy.
 *
 * These keys are deliberately NOT registered in `APP_CONFIG_DEFAULTS`: that
 * catalogue is a verbatim Procusto parity artifact (accents and all) and adding
 * Mobius-only keys to it would corrupt what it documents. The consequence is
 * stated plainly: overrides are set by inserting an `app_config` row, not from
 * the settings screen.
 */
export const NODE_FILES_CONFIG_KEYS = {
  model: "NodeFilesExtractionModel",
  effort: "NodeFilesExtractionEffort",
  maxTokens: "NodeFilesExtractionMaxTokens",
} as const;

export const NODE_FILES_DEFAULT_SETTINGS: IExtractionSettings = {
  model: "claude-opus-5",
  effort: "high",
  maxTokens: 16000,
};

/**
 * Per-company extraction settings, defaults where no row exists.
 *
 * A garbage override never breaks a run: an unknown effort or an unparseable
 * token budget falls back to the default and the run proceeds.
 */
export async function resolveExtractionSettings(
  companyId: number,
): Promise<IExtractionSettings> {
  const dao = new AppConfigDAO();
  const [model, effort, maxTokens] = await Promise.all([
    dao.getByKey(companyId, NODE_FILES_CONFIG_KEYS.model),
    dao.getByKey(companyId, NODE_FILES_CONFIG_KEYS.effort),
    dao.getByKey(companyId, NODE_FILES_CONFIG_KEYS.maxTokens),
  ]);

  const effortValue = effort?.value?.trim() as ExtractionEffort | undefined;
  const maxTokensValue = Number.parseInt(maxTokens?.value ?? "", 10);

  return {
    model: model?.value?.trim() || NODE_FILES_DEFAULT_SETTINGS.model,
    effort:
      effortValue && EFFORT_VALUES.includes(effortValue)
        ? effortValue
        : NODE_FILES_DEFAULT_SETTINGS.effort,
    maxTokens:
      Number.isFinite(maxTokensValue) && maxTokensValue > 0
        ? maxTokensValue
        : NODE_FILES_DEFAULT_SETTINGS.maxTokens,
  };
}
