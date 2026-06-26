// ---------------------------------------------------------------------------
// Server bootstrap. Start with:  npm start   (or npm run dev for auto-reload)
// ---------------------------------------------------------------------------
import { createApp } from "./app.js";
import { config, logConfigWarnings } from "./config.js";
import { bootstrap } from "./store/db.js";
import { startCron } from "./services/cron.js";
import { startCampaignWorker } from "./services/campaignWorker.js";
import { closePool } from "./db/pool.js";
import { logger } from "./logger.js";

logConfigWarnings(logger);

await bootstrap(); // apply schema, load data from Postgres, ensure plans + admin
startCron(); // subscription lifecycle + OTP cleanup
startCampaignWorker(); // throttled bulk delivery engine

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info(`🚀 textPanda API on http://localhost:${config.port}`);
  logger.info(`   Health:  http://localhost:${config.port}/api/health`);
  logger.info(`   Billing: Razorpay ${config.razorpay.keyId ? "LIVE" : "SIMULATED (no keys)"}`);
});

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down…`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
