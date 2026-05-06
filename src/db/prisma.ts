import { PrismaClient } from "../../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pool } from "./pool.js";
import { dbLogger } from "../core/utils/logger.js";
import { env } from "../config/env.js";

const adapter = new PrismaPg(pool);

const prismaLogLevels: ("query" | "info" | "warn" | "error")[] = [
  "info",
  "warn",
  "error",
];

if (process.env.PRISMA_LOG_QUERIES === "true") {
  prismaLogLevels.unshift("query");
}

export const prisma = new PrismaClient({
  adapter,
  log: prismaLogLevels,
});

/**
 * Graceful shutdown
 */
const shutdown = async () => {
  dbLogger.info("Shutting down gracefully");
  await prisma.$disconnect();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
