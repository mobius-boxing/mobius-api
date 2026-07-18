import { AppConfigDAO } from "../dao/app-config/app-config.dao";
import {
  APP_CONFIG_DEFAULTS,
  APP_CONFIG_DEFAULTS_BY_KEY,
  AppConfigValueType,
} from "../common/constants/app-config-defaults";
import { IAppConfigEntry } from "../interfaces/app-config/app-config.interfaces";

/**
 * Typed per-company settings surface over app_config (Procusto's
 * `ItemsDeConfiguracion` replacement). Absent rows resolve to the seeded
 * defaults — reads never write (unlike Procusto's GetItem null-row insert).
 */
export class AppConfigService {
  private dao = new AppConfigDAO();

  private coerce(
    raw: string | null,
    valueType: AppConfigValueType,
  ): boolean | number | string {
    const value = raw ?? "";
    switch (valueType) {
      case "bool":
        // Procusto stores .NET Convert.ToString booleans: "True"/"False".
        return value.toLowerCase() === "true";
      case "int":
      case "short": {
        const n = parseInt(value, 10);
        return Number.isNaN(n) ? 0 : n;
      }
      case "double": {
        const n = parseFloat(value);
        return Number.isNaN(n) ? 0 : n;
      }
      default:
        return value;
    }
  }

  private serialize(value: boolean | number | string, valueType: AppConfigValueType): string {
    if (valueType === "bool") {
      // Keep .NET-style casing so values migrate back/compare cleanly with Procusto dumps.
      return value === true || value === "true" || value === "True" ? "True" : "False";
    }
    return String(value);
  }

  /** Typed get with default fallback. Unknown keys throw. */
  async get(companyId: number, key: string): Promise<boolean | number | string> {
    const def = APP_CONFIG_DEFAULTS_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown config key: ${key}`);
    const row = await this.dao.getByKey(companyId, key);
    return this.coerce(row ? row.value : def.defaultValue, def.valueType);
  }

  async getBool(companyId: number, key: string): Promise<boolean> {
    return (await this.get(companyId, key)) as boolean;
  }

  async getNumber(companyId: number, key: string): Promise<number> {
    return (await this.get(companyId, key)) as number;
  }

  /** Upsert one override row. Unknown keys throw (the catalogue is closed for now). */
  async set(
    companyId: number,
    key: string,
    value: boolean | number | string,
  ): Promise<IAppConfigEntry> {
    const def = APP_CONFIG_DEFAULTS_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown config key: ${key}`);
    const raw = this.serialize(value, def.valueType);
    const row = await this.dao.upsert(companyId, key, raw, def.valueType);
    return {
      key,
      valueType: def.valueType,
      value: this.coerce(row.value, def.valueType),
      rawValue: row.value ?? "",
      isOverridden: true,
    };
  }

  /** Delete the override so the key reverts to its default. */
  async reset(companyId: number, key: string): Promise<void> {
    const def = APP_CONFIG_DEFAULTS_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown config key: ${key}`);
    await this.dao.deleteByKey(companyId, key);
  }

  /** One merged entry (single-key lookup — does not materialize the catalogue). */
  async getEntry(companyId: number, key: string): Promise<IAppConfigEntry | null> {
    const def = APP_CONFIG_DEFAULTS_BY_KEY.get(key);
    if (!def) return null;
    const row = await this.dao.getByKey(companyId, key);
    const raw = row ? (row.value ?? "") : def.defaultValue;
    return {
      key,
      valueType: def.valueType,
      value: this.coerce(raw, def.valueType),
      rawValue: raw,
      isOverridden: !!row,
    };
  }

  /** Full merged view (defaults + overrides) for the settings UI. */
  async getAll(companyId: number): Promise<IAppConfigEntry[]> {
    const rows = await this.dao.getAllForCompany(companyId);
    const overrides = new Map(rows.map((r) => [r.key, r]));
    return APP_CONFIG_DEFAULTS.map((def) => {
      const row = overrides.get(def.key);
      const raw = row ? (row.value ?? "") : def.defaultValue;
      return {
        key: def.key,
        valueType: def.valueType,
        value: this.coerce(raw, def.valueType),
        rawValue: raw,
        isOverridden: !!row,
      };
    });
  }

  async resolveCompanyId(companyUuid: string): Promise<number | null> {
    return this.dao.resolveCompanyId(companyUuid);
  }
}
