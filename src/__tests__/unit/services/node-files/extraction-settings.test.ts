/**
 * Provider selection and — the sharp edge — the DEFAULT MODEL that follows
 * from it.
 *
 * What is being protected: the default model used to be the literal
 * `"claude-opus-5"`. Flipping the provider to OpenAI while that literal
 * survived would send an Anthropic model id to OpenAI and 404 every single
 * run, on a config change that looks like a one-word edit. The pinning test
 * below is `provider=openai with no NodeFilesExtractionModel row`, and it
 * asserts the negative explicitly: never `claude-opus-5`.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { IAppConfig } from "../../../../interfaces/app-config/app-config.interfaces";

const mockGetByKey =
  jest.fn<(companyId: number, key: string) => Promise<IAppConfig | null>>();

jest.mock("../../../../dao/app-config/app-config.dao", () => ({
  AppConfigDAO: class {
    getByKey(companyId: number, key: string) {
      return mockGetByKey(companyId, key);
    }
  },
}));

import {
  NODE_FILES_CONFIG_KEYS,
  NODE_FILES_DEFAULT_MODELS,
  NODE_FILES_DEFAULT_PROVIDER,
  NODE_FILES_DEFAULT_SETTINGS,
  resolveExtractionSettings,
} from "../../../../services/node-files/extraction/extraction-provider";
import { ClaudeExtractionProvider } from "../../../../services/node-files/extraction/claude-extraction.provider";
import { OpenAIExtractionProvider } from "../../../../services/node-files/extraction/openai-extraction.provider";
import { providerFor } from "../../../../services/node-files/node-files-worker";

const COMPANY_ID = 7;

/** Only the keys named here have a row; everything else is unset. */
function rows(values: Record<string, string>): void {
  mockGetByKey.mockImplementation(async (_companyId, key) =>
    key in values
      ? ({ key, value: values[key] } as unknown as IAppConfig)
      : null,
  );
}

describe("resolveExtractionSettings", () => {
  beforeEach(() => {
    mockGetByKey.mockReset();
  });

  it("defaults to the OpenAI provider when no row exists", async () => {
    rows({});
    const settings = await resolveExtractionSettings(COMPANY_ID);
    expect(settings.provider).toBe("openai");
    expect(NODE_FILES_DEFAULT_PROVIDER).toBe("openai");
    expect(NODE_FILES_DEFAULT_SETTINGS.provider).toBe("openai");
  });

  it("never resolves an Anthropic model for the openai provider", async () => {
    rows({ [NODE_FILES_CONFIG_KEYS.provider]: "openai" });
    const settings = await resolveExtractionSettings(COMPANY_ID);

    expect(settings.model).toBe(NODE_FILES_DEFAULT_MODELS.openai);
    expect(settings.model).not.toBe("claude-opus-5");
    expect(settings.model).not.toMatch(/claude/i);
  });

  it("resolves the Claude default model for the claude provider", async () => {
    rows({ [NODE_FILES_CONFIG_KEYS.provider]: "claude" });
    const settings = await resolveExtractionSettings(COMPANY_ID);

    expect(settings.provider).toBe("claude");
    expect(settings.model).toBe("claude-opus-5");
  });

  it("lets an explicit model row override the per-provider default", async () => {
    rows({
      [NODE_FILES_CONFIG_KEYS.provider]: "openai",
      [NODE_FILES_CONFIG_KEYS.model]: "gpt-4o-mini",
    });
    const settings = await resolveExtractionSettings(COMPANY_ID);

    expect(settings.provider).toBe("openai");
    expect(settings.model).toBe("gpt-4o-mini");
  });

  it("falls back to the default provider on a garbage row, as effort does", async () => {
    rows({
      [NODE_FILES_CONFIG_KEYS.provider]: "gemini",
      [NODE_FILES_CONFIG_KEYS.effort]: "turbo",
      [NODE_FILES_CONFIG_KEYS.maxTokens]: "not-a-number",
    });
    const settings = await resolveExtractionSettings(COMPANY_ID);

    expect(settings.provider).toBe(NODE_FILES_DEFAULT_PROVIDER);
    // And the model still follows the resolved provider, not the garbage one.
    expect(settings.model).toBe(
      NODE_FILES_DEFAULT_MODELS[NODE_FILES_DEFAULT_PROVIDER],
    );
    expect(settings.effort).toBe(NODE_FILES_DEFAULT_SETTINGS.effort);
    expect(settings.maxTokens).toBe(NODE_FILES_DEFAULT_SETTINGS.maxTokens);
  });

  it("accepts a provider row with stray case and whitespace", async () => {
    rows({ [NODE_FILES_CONFIG_KEYS.provider]: "  Claude " });
    const settings = await resolveExtractionSettings(COMPANY_ID);

    expect(settings.provider).toBe("claude");
    expect(settings.model).toBe("claude-opus-5");
  });
});

describe("providerFor", () => {
  const base = { model: "m", effort: "high", maxTokens: 100 } as const;

  it("selects the Claude provider for the claude setting", () => {
    expect(providerFor({ ...base, provider: "claude" })).toBeInstanceOf(
      ClaudeExtractionProvider,
    );
  });

  it("selects the OpenAI provider for the openai setting", () => {
    expect(providerFor({ ...base, provider: "openai" })).toBeInstanceOf(
      OpenAIExtractionProvider,
    );
  });
});
