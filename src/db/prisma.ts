import { PrismaClient } from "../../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pool } from "./pool.js";

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: ["query", "info", "warn", "error"],
});

/**
 * Graceful shutdown
 */
const shutdown = async () => {
  console.log("Shutting down gracefully...");
  await prisma.$disconnect();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
