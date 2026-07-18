import { AppConfigValueType } from "../../common/constants/app-config-defaults";

export interface IAppConfig {
  id?: number;
  uuid: string;
  companyId: number;
  key: string;
  value: string | null;
  valueType: AppConfigValueType;
  legacyId?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One entry of the merged (defaults + overrides) config view returned to the UI. */
export interface IAppConfigEntry {
  key: string;
  valueType: AppConfigValueType;
  /** Typed value after coercion (boolean | number | string). */
  value: boolean | number | string;
  /** Raw stored/default string. */
  rawValue: string;
  /** true when the company has an explicit override row. */
  isOverridden: boolean;
}
