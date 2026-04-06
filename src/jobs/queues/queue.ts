import { Queue } from "bullmq";
import { bullRedis } from "../../config/redis.js";

export const emailQueue = new Queue("emailQueue", {
  connection: bullRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
