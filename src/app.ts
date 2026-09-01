import dotenv from "dotenv";
import express, { type Express } from "express";
import logger from "morgan";
import cors from "cors";
import helmet from "helmet";
import { IndexRouter } from "./routes/index";
import { errorMiddleware } from "./middlewares/error/error.middleware";
import {
  isOriginAllowed,
  validateAllowedOrigins,
} from "./common/config/origins/origins.config";
import { globalRateLimiter } from "./middlewares/rate-limit.middleware";
import { sanitizeResponse } from "./middlewares/sanitize-response.middleware";
import { auditContext } from "./middlewares/audit-context.middleware";
dotenv.config();

// SECURITY (H4): fail fast if the CORS allowlist is missing in production.
validateAllowedOrigins();

const app: Express = express();

// SECURITY (H3): the API sits behind a single proxy (CloudFront). Trust exactly one hop so
// express-rate-limit derives the real client IP from req.ip instead of a spoofable header.
app.set("trust proxy", 1);

// SECURITY (H4): security headers (HSTS, no-sniff, frameguard, etc.) with sane defaults.
app.use(helmet());

app.use(
  logger("tiny", {
    skip: (req, _res) => {
      return req.originalUrl.startsWith("/api/health");
    },
  }),
);

app.use(
  cors({
    // The allowlist is consulted per request (never an echo of the caller's Origin), and it is
    // read from the environment on every call so wildcard entries such as
    // `https://*.vencimientos.mobiusboxing.com` cover whitelabel customers that did not exist at
    // boot: onboarding a customer is a DNS + database change, never an API redeploy.
    // An unmatched origin gets `false` — cors() then simply omits the CORS headers.
    origin: (origin, callback) =>
      callback(null, !!origin && isOriginAllowed(origin)),
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    // A cross-origin browser can only read headers named here. File downloads
    // (countdown's Excel export) are fetched with the auth header rather than a
    // plain <a href>, so the SPA reads the server-chosen filename and the
    // truncation flag off the response — without this they are silently
    // invisible and the download lands with a guessed name.
    // `X-Request-Id` (audit P1) identifies the request in the audit trail and in
    // the API log; without it here the browser cannot read it off the response,
    // so a support conversation has no id to quote.
    exposedHeaders: [
      "Content-Disposition",
      "X-Export-Rows",
      "X-Export-Truncated",
      "X-Request-Id",
    ],
  }),
);

// SECURITY (H2): cap request body size to mitigate memory-exhaustion DoS.
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));

// SECURITY (H3): global default limiter across all routes (per-route limiters add stricter caps).
app.use(globalRateLimiter);

// SECURITY (M3): strip internal numeric ids (PK `id` + numeric `*Id` FKs) from every response.
app.use(sanitizeResponse);

// AUDIT (P1): opens the per-request audit state and, for a mutating request,
// commits or rolls back everything it opened before the response is written.
// Position is load-bearing: AFTER `sanitizeResponse` (which wraps `res.json`,
// while this wraps `res.end` — the two never see each other) and BEFORE the
// routers, so every route is covered and `X-Request-Id` is on every response.
// Kill switch: `AUDIT_AMBIENT_TX=off`.
app.use(auditContext);

const indexRouter = new IndexRouter().router;
app.use("/api", indexRouter);

app.use(errorMiddleware);

export default app;
