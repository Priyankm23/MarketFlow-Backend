import { Redis } from "ioredis";
import { env } from "./env.js";

// We will add REDIS_URL to env.ts as well
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3, // Don't hang forever if Redis is down
  // enableOfflineQueue: false, // Prevents hanging operations when Redis is disconnected
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});

redis.on("connect", () => {
  console.log("Successfully connected to Redis");
});
