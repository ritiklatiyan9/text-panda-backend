// ---------------------------------------------------------------------------
// Express application wiring for the multi-tenant SMS SaaS.
//
//   /api/health        public liveness
//   /api/auth/*        signup / login / me / public plans
//   /api/admin/*       operator console   (JWT, role=admin)
//   /api/client/*      client portal      (JWT, role=client)
//   /api/v1/*          public API         (X-API-Key) — what clients integrate
// ---------------------------------------------------------------------------
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { clientRouter } from "./routes/client.routes.js";
import { v1Router } from "./routes/v1.routes.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "128kb" }));
  app.use(cors({ origin: config.corsOrigin }));
  app.use(morgan("dev"));

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/client", clientRouter);
  app.use("/api/v1", v1Router);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
