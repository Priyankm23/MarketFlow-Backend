import { Redis } from "ioredis";
import { env } from "./env.js";
import { cacheLogger, serializeError } from "../core/utils/logger.js";

// We will add REDIS_URL to env.ts as well
const redisUrl = env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3, // Don't hang forever if Redis is down
  // enableOfflineQueue: false, // Prevents hanging operations when Redis is disconnected
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

export const bullRedis = new Redis(redisUrl, {
  // BullMQ workers require this to be null for blocking commands.
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("error", (err) => {
  cacheLogger.error(
    {
      err: serializeError(err),
      client: "redis",
    },
    "Redis connection error",
  );
});

redis.on("connect", () => {
  cacheLogger.info({ client: "redis" }, "Redis connected");
});

bullRedis.on("error", (err) => {
  cacheLogger.error(
    {
      err: serializeError(err),
      client: "bullRedis",
    },
    "Bull Redis connection error",
  );
});

bullRedis.on("connect", () => {
  cacheLogger.info({ client: "bullRedis" }, "Bull Redis connected");
});
