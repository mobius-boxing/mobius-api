// @ts-nocheck
/**
 * SECURITY (M1): Cookie-only authentication MUST be rejected.
 *
 * The API authenticates exclusively via the `Authorization: Bearer <token>` header. It must NEVER
 * read a JWT from a cookie. This test sends a request to a protected endpoint with ONLY a
 * `Cookie: mobius_session=<valid-looking-jwt>` header and NO `Authorization` header, and asserts a
 * 401 — proving the cookie is ignored for authentication.
 *
 * We mount the real `authenticate` middleware on a throwaway Express app so the test exercises the
 * actual auth code path without needing a database (the request is rejected before any DB lookup,
 * because there is no Authorization header at all).
 */

import { describe, it, expect } from "@jest/globals";
import express from "express";
import request from "supertest";
import * as jwt from "jsonwebtoken";
import { authenticate } from "../../middlewares/auth.middleware";

const buildApp = () => {
  const app = express();
  app.get("/protected", authenticate, (_req, res) => {
    res.status(200).json({ success: true });
  });
  return app;
};

// A structurally valid, correctly-signed JWT — placed ONLY in a cookie. If the API ever read the
// cookie, this would (incorrectly) authenticate; it must not.
const makeValidLookingJwt = () =>
  jwt.sign(
    {
      userId: "00000000-0000-4000-8000-000000000000",
      email: "attacker@example.com",
      role: "superAdmin",
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" },
  );

describe("SECURITY (M1): cookie-only auth is rejected", () => {
  it("returns 401 when a JWT is supplied only via Cookie and no Authorization header", async () => {
    const app = buildApp();
    const token = makeValidLookingJwt();

    const res = await request(app)
      .get("/protected")
      .set("Cookie", `mobius_session=${token}`);
    // Deliberately NO .set("Authorization", ...)

    expect(res.status).toBe(401);
    expect(res.body?.success).toBe(false);
  });

  it("still returns 401 for a totally missing credential (control)", async () => {
    const app = buildApp();

    const res = await request(app).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body?.success).toBe(false);
  });
});
