import { collect } from "../input/shared/ValidationError";
import {
  optionalInt,
  optionalText,
  oneOfText,
  requiredInt,
  requiredText,
  toBoolean,
} from "../input/shared/fieldValidators";
import { FieldValidationError } from "../input/shared/ValidationError";
import {
  DB_SERVER_KINDS,
  DB_SERVER_SSL_MODES,
  type DbServerKind,
  type DbServerSslMode,
} from "../../interfaces/tenant/tenant.interfaces";

/** `db_servers.adminCredentialRef` CHECK (model). */
const CREDENTIAL_REF_PATTERN = /^(env|enc|secretsmanager):/;

export const DB_SERVER_LIMITS = { name: 255, adminUser: 255 };
export const DB_SERVER_LABELS = {
  name: "El nombre",
  kind: "El tipo",
  host: "El host",
  port: "El puerto",
  sslMode: "El modo SSL",
  adminUser: "El usuario administrador",
  adminCredentialRef: "La referencia de credencial",
  connectionBudget: "El presupuesto de conexiones",
};

/**
 * `POST /api/db-servers` body (model). `host`/`port`/`sslMode` defaults are
 * conditional on `kind` (D-26: the shared container is env-relative), so they
 * are resolved here rather than at the database — a NULL `host` on a `rds`
 * row would silently fall back to the core server, which is the one thing
 * this DTO must never allow.
 */
export class DbServerCreateInputDTO {
  name: string;
  kind: DbServerKind;
  host: string | null;
  port: number | null;
  sslMode: DbServerSslMode;
  adminUser?: string;
  adminCredentialRef?: string;
  connectionBudget: number;
  isDefaultPlacement: boolean;

  constructor(data: any) {
    this.name = data?.name;
    this.kind = data?.kind;
    this.host = data?.host ?? null;
    this.port = data?.port ?? null;
    this.sslMode = data?.sslMode;
    if (data?.adminUser !== undefined) this.adminUser = data.adminUser;
    if (data?.adminCredentialRef !== undefined)
      this.adminCredentialRef = data.adminCredentialRef;
    this.connectionBudget = data?.connectionBudget;
    this.isDefaultPlacement = data?.isDefaultPlacement ?? false;
  }

  public build(): this {
    collect((field) => {
      this.name = field("name", () =>
        requiredText(this.name, DB_SERVER_LIMITS.name, DB_SERVER_LABELS.name),
      );
      this.kind = field("kind", () =>
        oneOfText(this.kind, DB_SERVER_KINDS, DB_SERVER_LABELS.kind),
      );
      this.connectionBudget = field("connectionBudget", () =>
        requiredInt(
          this.connectionBudget,
          { min: 1 },
          DB_SERVER_LABELS.connectionBudget,
        ),
      );
      this.isDefaultPlacement = field(
        "isDefaultPlacement",
        () => toBoolean(this.isDefaultPlacement, "isDefaultPlacement") ?? false,
      );

      field("host", () => {
        if (this.kind === "shared_container") {
          this.host = null;
          return this.host;
        }
        this.host = requiredText(this.host, 255, DB_SERVER_LABELS.host);
        return this.host;
      });

      field("port", () => {
        if (this.kind === "shared_container") {
          this.port = null;
          return this.port;
        }
        const parsed = optionalInt(
          this.port ?? 5432,
          { min: 1, max: 65535 },
          DB_SERVER_LABELS.port,
        );
        this.port = parsed ?? 5432;
        return this.port;
      });

      field("sslMode", () => {
        const fallback: DbServerSslMode =
          this.kind === "shared_container" ? "disable" : "require";
        const raw = optionalText(this.sslMode, 32, DB_SERVER_LABELS.sslMode);
        this.sslMode =
          raw === undefined
            ? fallback
            : oneOfText(raw, DB_SERVER_SSL_MODES, DB_SERVER_LABELS.sslMode);
        return this.sslMode;
      });

      field("adminUser", () => {
        this.adminUser = optionalText(
          this.adminUser,
          DB_SERVER_LIMITS.adminUser,
          DB_SERVER_LABELS.adminUser,
        ) as string | undefined;
        return this.adminUser;
      });

      field("adminCredentialRef", () => {
        if (!this.adminUser) {
          this.adminCredentialRef = undefined;
          return this.adminCredentialRef;
        }
        this.adminCredentialRef = requiredText(
          this.adminCredentialRef,
          500,
          DB_SERVER_LABELS.adminCredentialRef,
        );
        if (!CREDENTIAL_REF_PATTERN.test(this.adminCredentialRef)) {
          throw new FieldValidationError(
            "adminCredentialRef",
            `${DB_SERVER_LABELS.adminCredentialRef} debe empezar con "env:", "enc:" o "secretsmanager:"`,
          );
        }
        return this.adminCredentialRef;
      });
    });

    return this;
  }
}
