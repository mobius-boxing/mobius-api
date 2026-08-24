import * as dns from "dns";
import * as https from "https";
import * as net from "net";
import * as os from "os";

/**
 * The SSRF boundary (brief D-4).
 *
 * The HTTP node is the first place in this codebase where a URL supplied by a
 * tenant becomes an outbound request from a server that sits inside a VPC, next
 * to a database, next to an instance metadata endpoint that hands out IAM
 * credentials to anyone who asks. Before this file the repo had no private-IP
 * blocklist, no scheme allowlist and no redirect checking anywhere. Phase 3's
 * `ctx.http` will use this same helper.
 *
 * The four things that make it a boundary rather than a validator:
 *
 *  1. **The scheme is an allowlist.** `https` only. Not "not file:", not "not
 *     gopher:" — anything that is not `https` is refused, so a scheme nobody
 *     thought of cannot be the hole.
 *  2. **Every resolved address is checked, not the first one.** A hostname that
 *     resolves to one public and one private address is refused outright: the
 *     alternative is a race where the connect picks the private one.
 *  3. **The connection is pinned to the address that was checked.** The socket
 *     is opened against the validated IP via a `lookup` that never touches DNS
 *     again, which is what closes DNS rebinding — otherwise validation and
 *     connection are two separate resolutions and an attacker only has to win
 *     the second one.
 *  4. **Redirects are followed by hand, and every hop is re-validated from
 *     scratch.** Trusting the first URL is the classic bypass: a public host
 *     answering `302 Location: http://169.254.169.254/…` is an SSRF with extra
 *     steps. `redirect: "manual"` semantics are not optional here.
 *
 * Everything refused throws `UrlGuardError`, whose message is shown to the
 * tenant and is therefore in Spanish and names no internal address.
 */

/** A refusal by the guard. The message reaches the tenant. */
export class UrlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlGuardError";
  }
}

/** How many `Location` hops are followed before giving up. */
export const MAX_REDIRECTS = 5;

/** Response body cap. A node that streams gigabytes into jsonb is an outage. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Per-hop wall clock. The total budget is this times the hops taken. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Hostnames that are never resolved, whatever DNS says. These are refused by
 * NAME because in several of them the interesting answer is not an address at
 * all (`metadata.google.internal` is only meaningful inside GCP) and because
 * refusing early gives a clearer message than "resolvió a una dirección
 * privada".
 */
const BLOCKED_HOST_NAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Suffixes that only ever name something inside the perimeter. */
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".home.arpa",
];

const ipv4Bytes = (address: string): number[] | null => {
  if (net.isIPv4(address) !== true) return null;
  return address.split(".").map((part) => Number.parseInt(part, 10));
};

/**
 * Is this IPv4 address off-limits? Every non-public range, spelled out, because
 * "not private" is a much larger set than most people remember: loopback and
 * RFC1918 are the famous ones, but shared-address space (CGNAT), the
 * link-local block that carries `169.254.169.254`, benchmarking, documentation,
 * multicast and the reserved top of the space are all reachable from inside a
 * VPC and none of them belong to a tenant's webhook.
 */
export function isBlockedIPv4(address: string): boolean {
  const bytes = ipv4Bytes(address);
  if (bytes === null) return true;
  const [a, b] = bytes as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && bytes[1] === 0 && bytes[2] === 0) return true; // 192.0.0/24
  if (a === 192 && bytes[1] === 0 && bytes[2] === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && bytes[2] === 99) return true; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && bytes[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && bytes[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 address to its 16 bytes, or `null` if it is not one. */
const ipv6Bytes = (address: string): number[] | null => {
  if (net.isIPv6(address) !== true) return null;
  const zoneless = address.split("%")[0] as string;
  const [head, tail] = zoneless.split("::") as [string, string | undefined];

  const groupsOf = (part: string): string[] =>
    part === "" ? [] : part.split(":");

  const headGroups = groupsOf(head);
  const tailGroups = tail === undefined ? [] : groupsOf(tail);

  // A trailing IPv4 literal (::ffff:127.0.0.1) is two groups, not one.
  const expand = (groups: string[]): number[] => {
    const out: number[] = [];
    for (const group of groups) {
      const embedded = ipv4Bytes(group);
      if (embedded) {
        out.push(...embedded);
        continue;
      }
      const value = Number.parseInt(group, 16);
      if (Number.isNaN(value)) return [];
      out.push((value >> 8) & 0xff, value & 0xff);
    }
    return out;
  };

  const headBytes = expand(headGroups);
  const tailBytes = expand(tailGroups);
  if (tail === undefined) return headBytes.length === 16 ? headBytes : null;

  const fill = 16 - headBytes.length - tailBytes.length;
  if (fill < 0) return null;
  return [...headBytes, ...new Array<number>(fill).fill(0), ...tailBytes];
};

/**
 * Is this IPv6 address off-limits?
 *
 * The subtle half is the embedded-IPv4 forms: `::ffff:169.254.169.254` and
 * `64:ff9b::169.254.169.254` are the metadata endpoint wearing a hat, and a
 * checker that only knows `::1` and `fc00::/7` waves both through. Both are
 * unwrapped and handed to the IPv4 rules.
 */
export function isBlockedIPv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (bytes === null) return true;

  const isZeroPrefix = (upTo: number): boolean =>
    bytes.slice(0, upTo).every((byte) => byte === 0);

  // ::ffff:a.b.c.d — IPv4-mapped.
  if (isZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIPv4(bytes.slice(12).join("."));
  }
  // 64:ff9b::/96 — the well-known NAT64 prefix.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return isBlockedIPv4(bytes.slice(12).join("."));
  }
  // :: and ::1, and every other IPv4-compatible address.
  if (isZeroPrefix(12)) return true;

  const [first, second] = bytes as [number, number, ...number[]];
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (first === 0xfe && (second & 0xc0) === 0x80) return true; // fe80::/10
  if (first === 0xff) return true; // ff00::/8 multicast
  if (
    first === 0x20 &&
    second === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return true; // 2001:db8::/32 documentation
  }
  return false;
}

/** One check for either family; anything unrecognisable is blocked. */
export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) return isBlockedIPv4(address);
  if (net.isIPv6(address)) return isBlockedIPv6(address);
  return true;
}

/**
 * The hostnames that mean "this API".
 *
 * Read from the environment on every call rather than captured at import, so a
 * test can set it and so a deploy that adds the variable does not need a
 * restart to be believed. `os.hostname()` covers the box's own name inside the
 * VPC; the loopback and private-range rules already cover reaching it by
 * address.
 */
export function selfHostNames(): Set<string> {
  const names = new Set<string>();
  const add = (value: string | undefined): void => {
    const trimmed = (value ?? "").trim();
    if (trimmed === "") return;
    // Accepts both a bare host and a full URL.
    const host = trimmed.includes("://")
      ? (() => {
          try {
            return new URL(trimmed).hostname;
          } catch {
            return "";
          }
        })()
      : trimmed;
    if (host !== "") names.add(host.toLowerCase());
  };

  add(process.env.API_PUBLIC_URL);
  add(process.env.API_URL);
  add(process.env.PUBLIC_URL);
  add(os.hostname());
  for (const extra of (process.env.NF_BLOCKED_HOSTS ?? "").split(",")) {
    add(extra);
  }
  return names;
}

/** Refuse a hostname on its name alone, before DNS is consulted. */
export function isBlockedHostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return true;
  if (BLOCKED_HOST_NAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)))
    return true;
  if (selfHostNames().has(host)) return true;
  return false;
}

/** A URL that passed every check, together with the address it is pinned to. */
export interface IAllowedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

/**
 * Parse, validate and resolve one URL. Throws `UrlGuardError` on anything that
 * is not a public https endpoint.
 *
 * The resolution is deliberately `all: true`: a host with a public A record and
 * a private AAAA record is refused rather than partially trusted.
 */
export async function resolveAllowedTarget(
  rawUrl: string,
): Promise<IAllowedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlGuardError(`La URL no es válida: ${rawUrl}`);
  }

  if (url.protocol !== "https:") {
    throw new UrlGuardError(
      `Solo se permiten URLs https (recibido: ${url.protocol.replace(":", "")})`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new UrlGuardError("La URL no puede incluir usuario ni contraseña");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostName(hostname)) {
    throw new UrlGuardError(`Destino no permitido: ${url.hostname}`);
  }

  // An address literal skips DNS entirely — there is nothing to resolve, and
  // `dns.lookup` would happily hand it straight back.
  if (net.isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new UrlGuardError(`Destino no permitido: ${url.hostname}`);
    }
    return {
      url,
      address: hostname,
      family: net.isIPv6(hostname) ? 6 : 4,
    };
  }

  let resolved: dns.LookupAddress[];
  try {
    resolved = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new UrlGuardError(`No se pudo resolver el dominio ${url.hostname}`);
  }
  if (resolved.length === 0) {
    throw new UrlGuardError(`No se pudo resolver el dominio ${url.hostname}`);
  }
  // EVERY answer, not the one we happen to like: a mixed answer set is a race
  // waiting to be lost.
  for (const entry of resolved) {
    if (isBlockedAddress(entry.address)) {
      throw new UrlGuardError(`Destino no permitido: ${url.hostname}`);
    }
  }

  const chosen = resolved[0] as dns.LookupAddress;
  return {
    url,
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  };
}

export interface ISafeRequestOptions {
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * Header names that carry a secret and MUST NOT survive a redirect to a
   * different host. The caller names them because only the caller knows which
   * header its credential was injected into — a credential can be a bearer
   * token in `Authorization` or an API key in any header the tenant chose.
   * `ALWAYS_SENSITIVE_HEADERS` is stripped on top of whatever is listed here.
   */
  sensitiveHeaders?: string[];
}

/**
 * Stripped on every cross-host redirect regardless of what the caller declares.
 * Destination validation proves the next hop is not private; it says NOTHING
 * about whether it is the party the secret was minted for.
 */
const ALWAYS_SENSITIVE_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
];

/**
 * Drop every secret-bearing header. Called only when the redirect target's host
 * differs from the host that answered.
 */
function stripSensitiveHeaders(
  headers: Record<string, string>,
  declared: string[] | undefined,
): Record<string, string> {
  const blocked = new Set([
    ...ALWAYS_SENSITIVE_HEADERS,
    ...(declared ?? []).map((name) => name.toLowerCase()),
  ]);
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!blocked.has(name.toLowerCase())) kept[name] = value;
  }
  return kept;
}

export interface ISafeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The URL that actually answered, after any redirects. */
  finalUrl: string;
  redirects: number;
  /** True when the body was cut at `maxBytes`. */
  truncated: boolean;
}

export interface IHopResponse extends ISafeResponse {
  location: string | null;
}

/**
 * How one hop is performed. Injectable for exactly one reason: the redirect
 * re-check is the rule most likely to be quietly broken by a later edit, and
 * testing it against a real server is impossible here — a local server lives on
 * loopback, which the guard blocks by design. With this seam a test can hand
 * back "302 Location: http://169.254.169.254/" and assert that the SECOND hop is
 * refused, which is the invariant that matters.
 */
export type HopPerformer = (
  target: IAllowedTarget,
  options: ISafeRequestOptions,
) => Promise<IHopResponse>;

/** One hop against an already-validated, already-resolved target. */
function requestHop(
  target: IAllowedTarget,
  options: ISafeRequestOptions,
): Promise<IHopResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;

  return new Promise<IHopResponse>((resolve, reject) => {
    const request = https.request(
      {
        // `hostname` drives SNI and the Host header; `lookup` decides where the
        // socket actually goes. Both matter: pinning without the real hostname
        // breaks TLS, and the hostname without pinning re-opens rebinding.
        hostname: target.url.hostname.replace(/^\[|\]$/g, ""),
        port: target.url.port === "" ? 443 : Number(target.url.port),
        path: `${target.url.pathname}${target.url.search}`,
        method: options.method,
        headers: options.headers,
        timeout: timeoutMs,
        lookup: (
          _hostname: string,
          lookupOptions: dns.LookupOneOptions | dns.LookupAllOptions,
          callback: (
            err: NodeJS.ErrnoException | null,
            address: string | dns.LookupAddress[],
            family?: number,
          ) => void,
        ): void => {
          // The pin. No DNS happens here, so nothing can have changed between
          // the check above and this connect.
          if ((lookupOptions as dns.LookupAllOptions).all === true) {
            callback(null, [
              { address: target.address, family: target.family },
            ]);
            return;
          }
          callback(null, target.address, target.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;

        response.on("data", (chunk: Buffer) => {
          if (truncated) return;
          received += chunk.length;
          if (received > maxBytes) {
            truncated = true;
            chunks.push(
              chunk.subarray(0, chunk.length - (received - maxBytes)),
            );
            // Stop paying for bytes we have already decided to throw away.
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });

        const finish = (): void => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            headers[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: target.url.toString(),
            redirects: 0,
            truncated,
            location: response.headers.location ?? null,
          });
        };

        response.on("end", finish);
        // `destroy()` above ends the stream with `close`, not `end`.
        response.on("close", finish);
        response.on("error", reject);
      },
    );

    request.on("timeout", () => {
      request.destroy(
        new UrlGuardError(`La solicitud superó los ${timeoutMs} ms de espera`),
      );
    });
    request.on("error", (err) => reject(err));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/**
 * A guarded HTTPS request: validate, pin, send, and re-validate every redirect.
 *
 * A 3xx without a `Location` is returned as-is (it is a real answer); a 3xx WITH
 * one is followed only after the new URL has been through the whole guard
 * again, from `new URL()` down to the resolved addresses. That re-check is the
 * point — the first URL being safe says nothing about the seventh.
 */
export async function safeHttpsRequest(
  rawUrl: string,
  options: ISafeRequestOptions,
  perform: HopPerformer = requestHop,
): Promise<ISafeResponse> {
  let currentUrl = rawUrl;
  let body = options.body;
  let headers = options.headers;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = await resolveAllowedTarget(currentUrl);
    const response = await perform(target, { ...options, headers, body });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect || response.location === null) {
      return { ...response, redirects: hop };
    }
    if (hop === MAX_REDIRECTS) {
      throw new UrlGuardError(
        `La solicitud superó los ${MAX_REDIRECTS} redireccionamientos`,
      );
    }

    // Relative Locations are the common case and must be resolved against the
    // URL that answered, not against the original request.
    const nextUrl = new URL(response.location, target.url);
    // A host change means the secret is about to be handed to a DIFFERENT party
    // than the one it was issued to. The guard proves the next hop is not a
    // private address; it cannot prove it is trustworthy. A compromised — or
    // merely malicious — endpoint that answers `302 Location: https://attacker/`
    // would otherwise have the tenant's credential replayed to it verbatim.
    if (nextUrl.host !== target.url.host) {
      headers = stripSensitiveHeaders(headers, options.sensitiveHeaders);
    }
    currentUrl = nextUrl.toString();
    // 303, and 301/302 on a POST, continue as GET without a body — following
    // them with the original body would replay the payload at a new host.
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        options.method !== "GET" &&
        options.method !== "HEAD")
    ) {
      body = undefined;
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new UrlGuardError("No se pudo completar la solicitud");
}
