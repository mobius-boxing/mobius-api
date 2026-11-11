import { Request, Response } from "express";
import { getAuthConfig } from "../common/config/auth/auth.config";

/** Only the refresh endpoints ever see the cookie (INV-16). */
const REFRESH_COOKIE_PATH = "/api/auth";

export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

export const readRefreshCookie = (req: Request): string | undefined =>
  readCookie(req, getAuthConfig().cookieName);

export const secondsUntil = (deadline: Date): number =>
  Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000));

const refreshCookieOptions = (maxAgeSeconds: number) => {
  const config = getAuthConfig();
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSeconds * 1000,
    secure: config.cookieSecure,
    ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
  };
};

export const setRefreshCookie = (
  res: Response,
  rawToken: string,
  maxAgeSeconds: number,
): void => {
  res.cookie(
    getAuthConfig().cookieName,
    rawToken,
    refreshCookieOptions(maxAgeSeconds),
  );
};

export const clearRefreshCookie = (res: Response): void => {
  res.cookie(getAuthConfig().cookieName, "", refreshCookieOptions(0));
};
