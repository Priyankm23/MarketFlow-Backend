import { prisma } from "../db/prisma.js";
import { logger, serializeError } from "../core/utils/logger.js";

const sessionCleanupLogger = logger.child({ component: "session-cleanup" });

/**
 * Script to clean up revoked and expired sessions from the database.
 * This runs as a standalone job to prevent the Session table from bloating over time.
 */
export async function cleanupSessions() {
  sessionCleanupLogger.info("Starting session cleanup");
  try {
    const result = await prisma.session.deleteMany({
      where: {
        OR: [
          { isRevoked: true }, // Sessions formally revoked (e.g., via logout or auth rotation)
          { expiresAt: { lt: new Date() } }, // Sessions that are naturally expired
        ],
      },
    });

    sessionCleanupLogger.info(
      { deletedCount: result.count },
      "Session cleanup completed",
    );
  } catch (error) {
    sessionCleanupLogger.error(
      { err: serializeError(error) },
      "Session cleanup failed",
    );
  }
}
