import dotenv from "dotenv";
import express, { type Express } from "express";
import logger from "morgan";
import cors from "cors";
import { IndexRouter } from "./routes/index";
import { errorMiddleware } from "./middlewares/error/error.middleware";
import { getAllowedOrigins } from "./common/config/origins/origins.config";
dotenv.config();

const app: Express = express();

app.use(
  logger("tiny", {
    skip: (req, _res) => {
      return req.originalUrl.startsWith("/api/health");
    },
  }),
);

app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use("/api", new IndexRouter().router);

app.use(errorMiddleware);

export default app;
