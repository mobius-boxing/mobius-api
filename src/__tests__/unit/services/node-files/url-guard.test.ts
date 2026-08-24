/**
 * The SSRF boundary (brief D-4, AC-6).
 *
 * This is a security test, not a coverage test: every case below is a bypass
 * that works if the corresponding rule is removed, and the suite is
 * mutation-checked (L-018) — breaking a rule on a scratch copy flips exactly
 * the test that names it.
 *
 * Everything here is offline by construction. Address literals skip DNS
 * entirely, `localhost` is refused by name before any resolution, and the
 * redirect case injects its hop instead of speaking to a server — a real one
 * would have to live on loopback, which the guard blocks by design.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import {
  IAllowedTarget,
  IHopResponse,
  ISafeRequestOptions,
  isBlockedIPv4,
  isBlockedIPv6,
  isBlockedHostName,
  resolveAllowedTarget,
  safeHttpsRequest,
  UrlGuardError,
} from "../../../../services/node-files/nodes/url-guard";

const OPTIONS: ISafeRequestOptions = { method: "GET", headers: {} };

/** A public IPv4 literal: no DNS, no packets, and not in any blocked range. */
const PUBLIC_IP = "93.184.216.34";

const refuses = async (url: string): Promise<string> => {
  try {
    await resolveAllowedTarget(url);
  } catch (err) {
    if (err instanceof UrlGuardError) return err.message;
    throw err;
  }
  throw new Error(`resolveAllowedTarget accepted ${url}, which is the bug`);
};

afterEach(() => {
  delete process.env.API_PUBLIC_URL;
  delete process.env.NF_BLOCKED_HOSTS;
});

describe("scheme allowlist", () => {
  it("refuses http://", async () => {
    expect(await refuses(`http://${PUBLIC_IP}/webhook`)).toContain(
      "Solo se permiten URLs https",
    );
  });

  it("refuses schemes nobody thought of", async () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://example.com/",
      "ftp://example.com/",
      // A scheme-relative bypass attempt still has to parse as an absolute URL.
      "HTTP://example.com/",
    ]) {
      await expect(resolveAllowedTarget(url)).rejects.toBeInstanceOf(
        UrlGuardError,
      );
    }
  });

  it("accepts a plain public https URL", async () => {
    const target = await resolveAllowedTarget(`https://${PUBLIC_IP}/hook`);
    expect(target.address).toBe(PUBLIC_IP);
    expect(target.url.pathname).toBe("/hook");
  });
});

describe("private, loopback and link-local ranges", () => {
  it("refuses loopback", async () => {
    expect(await refuses("https://127.0.0.1/")).toContain("no permitido");
    expect(await refuses("https://127.13.9.4/")).toContain("no permitido");
    expect(await refuses("https://[::1]/")).toContain("no permitido");
  });

  it("refuses RFC1918 space", async () => {
    expect(await refuses("https://10.0.0.5/")).toContain("no permitido");
    expect(await refuses("https://172.16.4.1/")).toContain("no permitido");
    expect(await refuses("https://192.168.1.1/")).toContain("no permitido");
  });

  it("refuses the cloud metadata endpoint", async () => {
    // The single most valuable target on the network: it hands out IAM
    // credentials to anything that can make a GET.
    expect(
      await refuses("https://169.254.169.254/latest/meta-data/"),
    ).toContain("no permitido");
    expect(isBlockedIPv4("169.254.169.254")).toBe(true);
  });

  it("refuses the metadata endpoint wearing an IPv6 hat", () => {
    expect(isBlockedIPv6("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIPv6("64:ff9b::169.254.169.254")).toBe(true);
    expect(isBlockedIPv6("::ffff:127.0.0.1")).toBe(true);
  });

  it("refuses the rest of the non-public space", () => {
    expect(isBlockedIPv4("0.0.0.0")).toBe(true);
    expect(isBlockedIPv4("100.64.0.1")).toBe(true); // CGNAT
    expect(isBlockedIPv4("198.18.0.1")).toBe(true); // benchmarking
    expect(isBlockedIPv4("224.0.0.1")).toBe(true); // multicast
    expect(isBlockedIPv4("255.255.255.255")).toBe(true);
    expect(isBlockedIPv6("fc00::1")).toBe(true); // unique-local
    expect(isBlockedIPv6("fe80::1")).toBe(true); // link-local
  });

  it("still allows ordinary public addresses", () => {
    expect(isBlockedIPv4(PUBLIC_IP)).toBe(false);
    expect(isBlockedIPv4("8.8.8.8")).toBe(false);
    expect(isBlockedIPv6("2606:4700:4700::1111")).toBe(false);
  });
});

describe("hostnames refused by name", () => {
  it("refuses localhost and perimeter suffixes", () => {
    expect(isBlockedHostName("localhost")).toBe(true);
    expect(isBlockedHostName("api.localhost")).toBe(true);
    expect(isBlockedHostName("db.internal")).toBe(true);
    expect(isBlockedHostName("printer.local")).toBe(true);
    expect(isBlockedHostName("metadata.google.internal")).toBe(true);
  });

  it("refuses the API's own host", async () => {
    process.env.API_PUBLIC_URL = "https://api.mobiusboxing.com";
    expect(isBlockedHostName("api.mobiusboxing.com")).toBe(true);
    expect(
      await refuses("https://api.mobiusboxing.com/api/node-files"),
    ).toContain("no permitido");
    // And only that host: the guard must not start refusing the world.
    expect(isBlockedHostName("api.otra-empresa.com")).toBe(false);
  });

  it("refuses hosts named in NF_BLOCKED_HOSTS", () => {
    process.env.NF_BLOCKED_HOSTS = "interno.empresa.com";
    expect(isBlockedHostName("interno.empresa.com")).toBe(true);
  });
});

describe("URL shapes that exist to confuse a parser", () => {
  it("refuses credentials embedded in the URL", async () => {
    expect(await refuses(`https://user:pass@${PUBLIC_IP}/`)).toContain(
      "usuario ni contraseña",
    );
  });

  it("refuses a URL that does not parse", async () => {
    expect(await refuses("https://")).toContain("no es válida");
  });
});

describe("redirects are re-validated at every hop", () => {
  /** A hop performer that answers one redirect and then a body. */
  const redirectingTo = (location: string): jest.Mock => {
    let hop = 0;
    return jest.fn(
      (target: IAllowedTarget): Promise<IHopResponse> =>
        Promise.resolve({
          status: hop++ === 0 ? 302 : 200,
          headers: {},
          body: "ok",
          finalUrl: target.url.toString(),
          redirects: 0,
          truncated: false,
          location: hop === 1 ? location : null,
        }),
    );
  };

  /**
   * Credential-bearing headers must not survive a hop to a different host.
   *
   * The guard proves the next hop is not a PRIVATE address. It cannot prove the
   * next hop is the party the secret was issued to. A tenant points an HTTP node
   * at their own (public, legitimate) endpoint with a bearer token; that endpoint
   * is compromised and answers `302 Location: https://attacker/`. Without this
   * rule the token is replayed to the attacker verbatim, and every address check
   * still passes, because the attacker is a perfectly ordinary public host.
   */
  describe("secrets do not survive a cross-host redirect", () => {
    const SECRET_OPTIONS = {
      ...OPTIONS,
      headers: {
        Authorization: "Bearer tenant-secret",
        "X-Api-Key": "tenant-api-key",
        Accept: "application/json",
      },
      sensitiveHeaders: ["X-Api-Key"],
    };

    it("strips Authorization and the declared credential header on a host change", async () => {
      const perform = redirectingTo("https://8.8.8.8/elsewhere");
      await safeHttpsRequest(
        `https://${PUBLIC_IP}/start`,
        SECRET_OPTIONS,
        perform as unknown as never,
      );
      const second = (perform as jest.Mock).mock.calls[1]?.[1] as {
        headers: Record<string, string>;
      };
      expect(second.headers.Authorization).toBeUndefined();
      expect(second.headers["X-Api-Key"]).toBeUndefined();
      // Non-secret headers are not collateral damage.
      expect(second.headers.Accept).toBe("application/json");
    });

    it("keeps them on a same-host redirect, which is not a disclosure", async () => {
      const perform = redirectingTo(`https://${PUBLIC_IP}/next`);
      await safeHttpsRequest(
        `https://${PUBLIC_IP}/start`,
        SECRET_OPTIONS,
        perform as unknown as never,
      );
      const second = (perform as jest.Mock).mock.calls[1]?.[1] as {
        headers: Record<string, string>;
      };
      expect(second.headers.Authorization).toBe("Bearer tenant-secret");
      expect(second.headers["X-Api-Key"]).toBe("tenant-api-key");
    });

    it("strips regardless of the header's casing", async () => {
      const perform = redirectingTo("https://8.8.8.8/elsewhere");
      await safeHttpsRequest(
        `https://${PUBLIC_IP}/start`,
        { ...SECRET_OPTIONS, headers: { authorization: "Bearer x" } },
        perform as unknown as never,
      );
      const second = (perform as jest.Mock).mock.calls[1]?.[1] as {
        headers: Record<string, string>;
      };
      expect(second.headers.authorization).toBeUndefined();
    });
  });

  it("refuses a redirect from an allowed host to the metadata endpoint", async () => {
    // Deliberately `https`: an `http` Location would be refused by the scheme
    // rule, and the test would then stay green even with every address rule
    // deleted — passing for a reason that has nothing to do with what it names
    // (L-018).
    const perform = redirectingTo("https://169.254.169.254/latest/meta-data/");
    await expect(
      safeHttpsRequest(
        `https://${PUBLIC_IP}/start`,
        OPTIONS,
        perform as unknown as never,
      ),
    ).rejects.toBeInstanceOf(UrlGuardError);
    // The first hop DID happen — the point is that the second one did not.
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect that downgrades to http on a public host", async () => {
    const perform = redirectingTo("http://8.8.8.8/plain");
    await expect(
      safeHttpsRequest(
        `https://${PUBLIC_IP}/start`,
        OPTIONS,
        perform as unknown as never,
      ),
    ).rejects.toBeInstanceOf(UrlGuardError);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to a private address even over https", async () => {
    const perform = redirectingTo("https://10.1.2.3/internal");
    await expect(
      safeHttpsRequest(
        `https://${PUBLIC_IP}/start`,
        OPTIONS,
        perform as unknown as never,
      ),
    ).rejects.toBeInstanceOf(UrlGuardError);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another public host", async () => {
    const perform = redirectingTo(`https://8.8.8.8/next`);
    const response = await safeHttpsRequest(
      `https://${PUBLIC_IP}/start`,
      OPTIONS,
      perform as unknown as never,
    );
    expect(response.status).toBe(200);
    expect(response.redirects).toBe(1);
    expect(perform).toHaveBeenCalledTimes(2);
  });

  it("does not replay a POST body onto the redirect target", async () => {
    const perform = redirectingTo(`https://8.8.8.8/next`);
    await safeHttpsRequest(
      `https://${PUBLIC_IP}/start`,
      { method: "POST", headers: {}, body: "secreto" },
      perform as unknown as never,
    );
    const calls = (perform as jest.Mock).mock.calls as unknown as Array<
      [IAllowedTarget, ISafeRequestOptions]
    >;
    expect(calls[0]?.[1].body).toBe("secreto");
    expect(calls[1]?.[1].body).toBeUndefined();
  });

  it("gives up rather than following a redirect loop forever", async () => {
    const perform = jest.fn(
      (target: IAllowedTarget): Promise<IHopResponse> =>
        Promise.resolve({
          status: 302,
          headers: {},
          body: "",
          finalUrl: target.url.toString(),
          redirects: 0,
          truncated: false,
          location: `https://${PUBLIC_IP}/again`,
        }),
    );
    await expect(
      safeHttpsRequest(
        `https://${PUBLIC_IP}/start`,
        OPTIONS,
        perform as unknown as never,
      ),
    ).rejects.toBeInstanceOf(UrlGuardError);
  });
});
