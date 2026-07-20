import dotenv from "dotenv";
import express, { type Express } from "express";
import logger from "morgan";
import cors from "cors";
import helmet from "helmet";
import { IndexRouter } from "./routes/index";
import { errorMiddleware } from "./middlewares/error/error.middleware";
import {
  getAllowedOrigins,
  validateAllowedOrigins,
} from "./common/config/origins/origins.config";
import { globalRateLimiter } from "./middlewares/rate-limit.middleware";
import { sanitizeResponse } from "./middlewares/sanitize-response.middleware";
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
    // Passing the allowlist array means cors() only reflects matching origins; it never echoes
    // an arbitrary Origin back with credentials:true.
    origin: getAllowedOrigins(),
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// SECURITY (H2): cap request body size to mitigate memory-exhaustion DoS.
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));

// SECURITY (H3): global default limiter across all routes (per-route limiters add stricter caps).
app.use(globalRateLimiter);

// SECURITY (M3): strip internal numeric ids (PK `id` + numeric `*Id` FKs) from every response.
app.use(sanitizeResponse);

const indexRouter = new IndexRouter().router;
app.use("/api", indexRouter);

app.use(errorMiddleware);

export default app;
