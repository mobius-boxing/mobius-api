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

/** Which vendor performs the extraction. Both are fully supported. */
export type NodeFilesExtractionProvider = "claude" | "openai";

export interface IExtractionSettings {
  provider: NodeFilesExtractionProvider;
  model: string;
  /**
   * Claude-only. Anthropic's `output_config.effort` has NO OpenAI equivalent
   * on the Responses API, so it is inert when `provider` is `"openai"` — see
   * `openai-extraction.provider.ts`, which logs when a non-default value is
   * configured rather than dropping it in silence (L-007's spirit).
   */
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

const PROVIDER_VALUES: NodeFilesExtractionProvider[] = ["claude", "openai"];

/**
 * Defaults, and the app_config keys that override them per company.
 *
 * The active default provider is OpenAI, on the owner's explicit instruction
 * (2026-08-25). Claude remains fully supported and is exactly one app_config
 * row away — `NodeFilesExtractionProvider = "claude"` on a company restores
 * `claude-opus-5` extraction for it, with no deploy. Neither default is to be
 * swapped without the owner's say-so; the point of reading them from
 * app_config is that such a decision needs a row, not a release.
 *
 * These keys are deliberately NOT registered in `APP_CONFIG_DEFAULTS`: that
 * catalogue is a verbatim Procusto parity artifact (accents and all) and adding
 * Mobius-only keys to it would corrupt what it documents. The consequence is
 * stated plainly: overrides are set by inserting an `app_config` row, not from
 * the settings screen.
 */
export const NODE_FILES_CONFIG_KEYS = {
  provider: "NodeFilesExtractionProvider",
  model: "NodeFilesExtractionModel",
  effort: "NodeFilesExtractionEffort",
  maxTokens: "NodeFilesExtractionMaxTokens",
} as const;

/**
 * The default model is a function of the provider, and MUST stay one.
 *
 * The trap this table exists to close: a single literal default (it used to be
 * `"claude-opus-5"`) sends an Anthropic model id to OpenAI the moment the
 * provider row flips, and every run 404s on a model that account has never
 * heard of. An explicit `NodeFilesExtractionModel` row still overrides this.
 */
export const NODE_FILES_DEFAULT_MODELS: Record<
  NodeFilesExtractionProvider,
  string
> = {
  claude: "claude-opus-5",
  openai: "gpt-4o",
};

export const NODE_FILES_DEFAULT_PROVIDER: NodeFilesExtractionProvider =
  "openai";

export const NODE_FILES_DEFAULT_SETTINGS: IExtractionSettings = {
  provider: NODE_FILES_DEFAULT_PROVIDER,
  model: NODE_FILES_DEFAULT_MODELS[NODE_FILES_DEFAULT_PROVIDER],
  effort: "high",
  maxTokens: 16000,
};

/**
 * Per-company extraction settings, defaults where no row exists.
 *
 * A garbage override never breaks a run: an unknown provider, an unknown
 * effort or an unparseable token budget falls back to the default and the run
 * proceeds. Note the ORDER — the provider is resolved first, because the model
 * default is read out of `NODE_FILES_DEFAULT_MODELS` by that provider.
 */
export async function resolveExtractionSettings(
  companyId: number,
): Promise<IExtractionSettings> {
  const dao = new AppConfigDAO();
  const [provider, model, effort, maxTokens] = await Promise.all([
    dao.getByKey(companyId, NODE_FILES_CONFIG_KEYS.provider),
    dao.getByKey(companyId, NODE_FILES_CONFIG_KEYS.model),
    dao.getByKey(companyId, NODE_FILES_CONFIG_KEYS.effort),
    dao.getByKey(companyId, NODE_FILES_CONFIG_KEYS.maxTokens),
  ]);

  const providerValue = provider?.value?.trim().toLowerCase() as
    | NodeFilesExtractionProvider
    | undefined;
  const resolvedProvider =
    providerValue && PROVIDER_VALUES.includes(providerValue)
      ? providerValue
      : NODE_FILES_DEFAULT_PROVIDER;

  const effortValue = effort?.value?.trim() as ExtractionEffort | undefined;
  const maxTokensValue = Number.parseInt(maxTokens?.value ?? "", 10);

  return {
    provider: resolvedProvider,
    model: model?.value?.trim() || NODE_FILES_DEFAULT_MODELS[resolvedProvider],
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
