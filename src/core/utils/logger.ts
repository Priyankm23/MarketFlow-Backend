import pino from "pino";
import { randomUUID } from "crypto";

const isDevelopment = (process.env.NODE_ENV ?? "development") === "development";

export const logger = pino({
  name: "marketflow-api",
  level: process.env.LOG_LEVEL ?? (isDevelopment ? "debug" : "info"),
  base: {
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            singleLine: true,
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

export const requestLogger = logger.child({ component: "http" });
export const dbLogger = logger.child({ component: "db" });
export const cacheLogger = logger.child({ component: "cache" });

export function getRequestId(existingId?: string) {
  return existingId?.trim() || randomUUID();
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}