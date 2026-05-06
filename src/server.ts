import app from "./app.js";
import { prisma } from "./db/prisma.js";
import { env } from "./config/env.js";
import { cleanupSessions } from "./jobs/cleanupSessions.js";
import { runInventoryCleanup } from "./jobs/inventoryCleanup.js";
import { startFlashDealsCacheRefresher } from "./jobs/refreshFlashDealsCache.js";
import { logger, serializeError } from "./core/utils/logger.js";

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
      logger.info(
        {
          host: dbFingerprint.host,
          database: dbFingerprint.name,
        },
        "Runtime database target",
      );

      if (env.EXPECTED_DB_HOST && env.EXPECTED_DB_HOST !== dbFingerprint.host) {
        logger.warn(
          {
            expected: env.EXPECTED_DB_HOST,
            actual: dbFingerprint.host,
          },
          "Database host mismatch",
        );
      }

      if (env.EXPECTED_DB_NAME && env.EXPECTED_DB_NAME !== dbFingerprint.name) {
        logger.warn(
          {
            expected: env.EXPECTED_DB_NAME,
            actual: dbFingerprint.name,
          },
          "Database name mismatch",
        );
      }
    } else {
      logger.warn("Could not parse DATABASE_URL for fingerprint logging");
    }

    await prisma.$connect();
    logger.info("Database connected successfully");

    app.listen(env.PORT, () => {
      logger.info(
        {
          port: env.PORT,
          nodeEnv: env.NODE_ENV,
        },
        "Server started",
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
      logger.error(
        {
          err: serializeError(err),
        },
        "Failed to start flash deals refresher",
      );
    });
  } catch (error) {
    logger.fatal(
      {
        err: serializeError(error),
      },
      "Failed to start server",
    );
    process.exit(1);
  }
}

startServer();
