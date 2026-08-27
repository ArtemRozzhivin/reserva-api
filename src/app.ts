import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import routes from "./routes";
import healthRoutes from "./routes/health.routes";
import readyRoutes from "./routes/ready.routes";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorMiddleware } from "./middleware/error.middleware";
import { notFoundMiddleware } from "./middleware/not-found.middleware";

export const app = express();

// Behind a reverse proxy/load balancer in production, so req.ip reflects the
// real client (X-Forwarded-For) rather than the proxy — essential for per-IP
// rate limiting. "1" = trust exactly one hop (the proxy), not arbitrary headers.
app.set("trust proxy", 1);

// Don't advertise the framework in a response header.
app.disable("x-powered-by");

// Structured request logging + a correlation id per request. Reuse an incoming
// X-Request-Id (from a proxy/upstream) or mint one; echo it back so a client or
// trace can tie its request to our logs. Liveness pings aren't worth logging.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const header = req.headers["x-request-id"];
      const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    autoLogging: {
      ignore: (req) => req.url === "/health" || req.url === "/ready",
    },
  }),
);

// Security headers: helmet sets a batch of safe HTTP response headers
// (clickjacking, MIME-sniffing, referrer leakage, etc.).
app.use(helmet());

// CORS: which browser origins may call this API. "*" allows any (dev);
// a comma-separated list becomes an allow-list.
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(","),
  }),
);

// Body parser with a size cap: reject oversized JSON payloads before they're
// buffered/parsed (a cheap DoS vector otherwise).
app.use(express.json({ limit: env.JSON_BODY_LIMIT }));

app.use("/health", healthRoutes);
app.use("/ready", readyRoutes);
app.use("/api/v1", routes);
app.use(notFoundMiddleware);
app.use(errorMiddleware);
