import {
  configInput,
  INodeRunContext,
  INodeRunResult,
  INodeType,
  INodeValidationContext,
  NodeConfigError,
  NodeExecutionError,
  optionalConfigText,
  requiredConfigText,
} from "./node-type";
import { renderTemplate, templatePaths } from "./template";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  safeHttpsRequest,
  UrlGuardError,
} from "./url-guard";

/**
 * The HTTP node: one guarded outbound request.
 *
 * Every URL this node touches goes through `url-guard` (brief D-4) — including
 * the URL after a redirect. The node itself contains no networking decisions;
 * it renders templates, assembles headers, and hands the result to the guard.
 *
 * Header rules, which are a security boundary of their own:
 *  - Header VALUES are templated, header NAMES are not. A name assembled from
 *    extracted text is header injection waiting for a `\r\n`.
 *  - `Host`, `Content-Length` and the hop-by-hop headers are refused: they
 *    belong to the transport, not to the tenant.
 *  - The credential's header wins over anything in the headers map, so a config
 *    cannot quietly overwrite `Authorization` with a value of its own.
 */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof METHODS)[number];

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

const MAX_HEADERS = 20;

/** Names the transport owns. A tenant setting any of them is a config error. */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

/** RFC 7230 token: no spaces, no colons, and above all no CR or LF. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

const parseMethod = (raw: unknown): HttpMethod => {
  const method = String(raw ?? "GET").toUpperCase();
  if (!(METHODS as readonly string[]).includes(method)) {
    throw new NodeConfigError(`Método inválido: usá ${METHODS.join(", ")}`);
  }
  return method as HttpMethod;
};

/** `{ "X-Api-Version": "2" }` — an object, validated name by name. */
function parseHeaders(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new NodeConfigError("Las cabeceras deben ser un objeto");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) {
    throw new NodeConfigError(`Máximo ${MAX_HEADERS} cabeceras`);
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new NodeConfigError(`Nombre de cabecera inválido: "${name}"`);
    }
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new NodeConfigError(`La cabecera "${name}" no se puede definir`);
    }
    if (typeof value !== "string") {
      throw new NodeConfigError(`El valor de "${name}" debe ser texto`);
    }
    headers[name] = value;
  }
  return headers;
}

function parseTimeout(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = typeof raw === "number" ? raw : Number(String(raw));
  if (
    !Number.isFinite(value) ||
    value < MIN_TIMEOUT_MS ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new NodeConfigError(
      `El tiempo de espera debe estar entre ${MIN_TIMEOUT_MS} y ${MAX_TIMEOUT_MS} ms`,
    );
  }
  return Math.round(value);
}

/** A rendered value must not smuggle a header separator into a header. */
function assertNoHeaderInjection(name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new NodeExecutionError(
      `El valor de la cabecera "${name}" contiene un salto de línea`,
    );
  }
}

function assertTemplatePaths(
  text: string,
  ctx: INodeValidationContext,
  label: string,
): void {
  const declared = new Set(ctx.fields.map((field) => field.key));
  for (const path of templatePaths(text)) {
    const [root, second] = path.split(".");
    if (root === "fields") {
      if (second === undefined || !declared.has(second)) {
        throw new NodeConfigError(
          `${label}: el flujo no declara el campo "${second ?? ""}"`,
        );
      }
      continue;
    }
    if (root === "document" || root === "nodes") continue;
    throw new NodeConfigError(
      `${label}: "${path}" no existe (usá fields., document. o nodes.)`,
    );
  }
}

export const httpNode: INodeType = {
  type: "http",
  label: "Llamada HTTP",
  description:
    "Hace una solicitud HTTPS a un sistema externo. Solo https y destinos públicos.",
  handles: ["out"],
  acceptsInput: true,
  configSchema: [
    configInput({
      key: "method",
      label: "Método",
      input: "select",
      required: true,
      options: METHODS.map((method) => ({ value: method, label: method })),
      defaultValue: "POST",
    }),
    configInput({
      key: "url",
      label: "URL",
      input: "text",
      required: true,
      templated: true,
      placeholder: "https://api.ejemplo.com/facturas",
      help: "Solo https. Se rechazan direcciones internas y privadas.",
    }),
    configInput({
      key: "headers",
      label: "Cabeceras",
      input: "keyValue",
      required: false,
      templated: true,
    }),
    configInput({
      key: "body",
      label: "Cuerpo",
      input: "textarea",
      required: false,
      templated: true,
      placeholder: '{"total": "{{fields.total}}"}',
    }),
    configInput({
      key: "credentialUuid",
      label: "Credencial",
      input: "credential",
      required: false,
      help: "Se agrega como cabecera. El secreto nunca se muestra.",
    }),
    configInput({
      key: "timeoutMs",
      label: "Tiempo de espera (ms)",
      input: "number",
      required: false,
      defaultValue: DEFAULT_TIMEOUT_MS,
    }),
  ],

  validate(config: Record<string, unknown>, ctx: INodeValidationContext): void {
    parseMethod(config.method);
    const url = requiredConfigText(config, "url", "La URL", 2000);
    assertTemplatePaths(url, ctx, "La URL");
    // A URL with no template in it can be checked for scheme right now; one
    // that is templated cannot be resolved until the run, where the guard
    // refuses it just as firmly.
    if (!url.includes("{{") && !url.toLowerCase().startsWith("https://")) {
      throw new NodeConfigError("La URL debe empezar con https://");
    }

    const headers = parseHeaders(config.headers);
    for (const [name, value] of Object.entries(headers)) {
      assertTemplatePaths(value, ctx, `La cabecera "${name}"`);
    }

    const body = optionalConfigText(config, "body", "El cuerpo", 100_000);
    if (body !== null) assertTemplatePaths(body, ctx, "El cuerpo");

    const credentialUuid = optionalConfigText(
      config,
      "credentialUuid",
      "La credencial",
      64,
    );
    if (credentialUuid !== null && credentialUuid.length < 8) {
      throw new NodeConfigError("La credencial seleccionada no es válida");
    }
    parseTimeout(config.timeoutMs);
  },

  credentialRefs(config: Record<string, unknown>): string[] {
    const uuid = config.credentialUuid;
    return typeof uuid === "string" && uuid.trim() !== "" ? [uuid.trim()] : [];
  },

  async run(
    ctx: INodeRunContext,
    config: Record<string, unknown>,
  ): Promise<INodeRunResult> {
    const source = {
      document: ctx.document,
      fields: ctx.fields,
      nodes: ctx.nodes,
    };
    const method = parseMethod(config.method);
    const url = renderTemplate(String(config.url ?? ""), source);
    const timeoutMs = parseTimeout(config.timeoutMs);

    const headers: Record<string, string> = {};
    // Names of headers holding a secret. safeHttpsRequest drops these the moment
    // a redirect crosses to a different host — the tenant's credential is for
    // the endpoint they configured, not for wherever that endpoint points next.
    const sensitiveHeaders: string[] = [];
    for (const [name, value] of Object.entries(parseHeaders(config.headers))) {
      const rendered = renderTemplate(value, source);
      assertNoHeaderInjection(name, rendered);
      headers[name] = rendered;
    }

    const rawBody =
      typeof config.body === "string" && config.body.trim() !== ""
        ? renderTemplate(config.body, source)
        : undefined;
    if (rawBody !== undefined && headers["Content-Type"] === undefined) {
      headers["Content-Type"] = "application/json";
    }

    // Last, so nothing in the config can overwrite it.
    const credentialUuid = this.credentialRefs(config)[0];
    if (credentialUuid !== undefined) {
      const credential = ctx.credentials.get(credentialUuid);
      if (!credential) {
        throw new NodeExecutionError(
          "La credencial configurada ya no existe o no se pudo descifrar",
        );
      }
      headers[credential.headerName] = credential.headerValue;
      sensitiveHeaders.push(credential.headerName);
      ctx.log(`credencial aplicada: ${credential.name}`);
    }

    ctx.log(`${method} ${url}`);
    try {
      const response = await safeHttpsRequest(url, {
        method,
        headers,
        body: rawBody,
        timeoutMs,
        maxBytes: MAX_RESPONSE_BYTES,
        sensitiveHeaders,
      });
      ctx.log(
        `respuesta ${response.status}` +
          (response.redirects > 0
            ? ` tras ${response.redirects} redirecciones`
            : ""),
      );

      // Parsed when it parses; the raw text otherwise. Never both.
      let parsed: unknown = response.body;
      try {
        parsed = JSON.parse(response.body) as unknown;
      } catch {
        parsed = response.body;
      }

      if (response.status >= 400) {
        throw new NodeExecutionError(
          `El servicio respondió ${response.status}`,
        );
      }

      return {
        output: {
          status: response.status,
          headers: response.headers,
          body: parsed,
          truncated: response.truncated,
          finalUrl: response.finalUrl,
        },
        handle: "out",
      };
    } catch (err) {
      throw toNodeError(err);
    }
  },
};

/**
 * Most-specific-first, exactly like `toExtractionError` next door — and for the
 * same reason: a parent class tested first makes every child branch
 * unreachable, and the tenant then reads a sentence describing a failure that
 * never happened.
 */
export function toNodeError(err: unknown): Error {
  if (err instanceof NodeExecutionError) return err;
  // A guard refusal is already tenant-facing Spanish and must keep its wording.
  if (err instanceof UrlGuardError) return new NodeExecutionError(err.message);
  if (err instanceof NodeConfigError)
    return new NodeExecutionError(err.message);
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (
    code === "ECONNREFUSED" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH"
  ) {
    return new NodeExecutionError("No se pudo conectar con el destino");
  }
  if (code === "ETIMEDOUT" || code === "ECONNRESET") {
    return new NodeExecutionError("El destino no respondió a tiempo");
  }
  if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    return new NodeExecutionError("El certificado del destino no es válido");
  }
  if (err instanceof Error) {
    console.error(`[node-files] http node error: ${err.message}`);
  }
  return new NodeExecutionError("Falló la llamada HTTP");
}
