import { prisma } from "../db/prisma.js";

/**
 * Script to clean up revoked and expired sessions from the database.
 * This runs as a standalone job to prevent the Session table from bloating over time.
 */
export async function cleanupSessions() {
  console.log("🧹 Starting session cleanup...");
  try {
    const result = await prisma.session.deleteMany({
      where: {
        OR: [
          { isRevoked: true }, // Sessions formally revoked (e.g., via logout or auth rotation)
          { expiresAt: { lt: new Date() } }, // Sessions that are naturally expired
        ],
      },
    });

    console.log(
      `✅ Successfully deleted ${result.count} revoked or expired sessions.`,
    );
  } catch (error) {
    console.error("❌ Failed to clean up sessions:", error);
  }
}
