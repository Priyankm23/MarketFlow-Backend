import app from "./app.js";
import { prisma } from "./db/prisma.js";
import { env } from "./config/env.js";
import { cleanupSessions } from "./jobs/cleanupSessions.js";
import { runInventoryCleanup } from "./jobs/inventoryCleanup.js";

async function startServer() {
  try {
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
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
