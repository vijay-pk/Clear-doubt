import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { env, isProd } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { authContext } from "./middleware/authContext.js";
import { csrfGuard } from "./middleware/csrf.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { webhookRouter } from "./routes/webhooks.js";
import { authRouter } from "./routes/auth.js";
import { doubtsRouter } from "./routes/doubts.js";
import { adminRouter } from "./routes/admin/index.js";
import { devRouter } from "./routes/dev.js";

export function createApp() {
  const app = express();
  if (env.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" } }));

  // Webhooks need the RAW body for signature verification — mount before JSON.
  app.use("/api/webhooks", webhookRouter);

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(authContext);
  app.use(csrfGuard);

  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  app.use("/api", apiLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api/doubts", doubtsRouter);
  app.use("/api/admin", adminRouter);
  if (env.ENABLE_DEV_ROUTES && !isProd) app.use("/api/dev", devRouter);

  // Serve the built SPA (single-service deploy) when present. Resolve against a
  // few candidates so it works under tsx dev and the compiled Docker image.
  const candidates = [
    fileURLToPath(new URL("../../web/dist", import.meta.url)),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(process.cwd(), "web/dist"),
  ];
  const webDist = candidates.find((p) => existsSync(path.join(p, "index.html")));
  if (webDist) {
    logger.info({ webDist }, "serving built SPA");
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  } else {
    logger.warn("no built SPA found (run `npm run build --workspace web`)");
  }

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
