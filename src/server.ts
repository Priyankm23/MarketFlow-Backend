import app from "./app.js";
import { prisma } from "./db/prisma.js";
import { env } from "./config/env.js";
import { cleanupSessions } from "./jobs/cleanupSessions.js";
import { runInventoryCleanup } from "./jobs/inventoryCleanup.js";
import { startFlashDealsCacheRefresher } from "./jobs/refreshFlashDealsCache.js";

function getDatabaseFingerprint(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname,
      name: parsed.pathname.replace(/^\/+/, "") || "unknown",
    };
  } catch {
    return null;
  }
}

async function startServer() {
  try {
    const dbFingerprint = getDatabaseFingerprint(env.DATABASE_URL);
    if (dbFingerprint) {
      console.log(
        `[DB] Runtime target -> host=${dbFingerprint.host} db=${dbFingerprint.name}`,
      );

      if (
        env.EXPECTED_DB_HOST &&
        env.EXPECTED_DB_HOST !== dbFingerprint.host
      ) {
        console.warn(
          `[DB] Expected host ${env.EXPECTED_DB_HOST}, but connected to ${dbFingerprint.host}`,
        );
      }

      if (
        env.EXPECTED_DB_NAME &&
        env.EXPECTED_DB_NAME !== dbFingerprint.name
      ) {
        console.warn(
          `[DB] Expected database ${env.EXPECTED_DB_NAME}, but connected to ${dbFingerprint.name}`,
        );
      }
    } else {
      console.warn("[DB] Could not parse DATABASE_URL for fingerprint logging");
    }

    await prisma.$connect();
    console.log("Database connected successfully.");

    app.listen(env.PORT, () => {
      console.log(
        `Server is running on port ${env.PORT} in ${env.NODE_ENV} mode`,
      );
    });

    cleanupSessions();

    // Check for expired inventory reservations every minute
    setInterval(
      () => {
        runInventoryCleanup();
      },
      60 * 5 * 1000,
    );

    // Start flash-deals cache refresher in background
    startFlashDealsCacheRefresher().catch((err) => {
      console.error("Failed to start flash deals refresher:", err);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
