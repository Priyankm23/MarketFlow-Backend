import { Worker } from "bullmq";
import { bullRedis } from "../../config/redis.js";
import {
  sendOrderPlacedInvoiceEmail,
  sendOrderDeliveredEmail,
  sendWelcomeEmail,
} from "../../core/utils/emailService.js";
import { logger, serializeError } from "../../core/utils/logger.js";

const workerLogger = logger.child({ component: "email-worker" });

const worker = new Worker(
  "emailQueue",
  async (job) => {
    workerLogger.info(
      { jobId: job.id, jobName: job.name },
      "Processing email job",
    );

    if (job.name === "welcome-email") {
      const { name, email } = job.data;

      await job.updateProgress(50);

      await sendWelcomeEmail({ name, email });

      await job.updateProgress(100);

      return { emailSentTo: email, sentAt: new Date().toISOString() };
    }

    if (job.name === "order-placed-invoice-email") {
      await job.updateProgress(30);
      await sendOrderPlacedInvoiceEmail(job.data);
      await job.updateProgress(100);

      return {
        invoiceSentTo: job.data.customerEmail,
        orderId: job.data.orderId,
        sentAt: new Date().toISOString(),
      };
    }

    if (job.name === "order-delivered-email") {
      await job.updateProgress(30);
      await sendOrderDeliveredEmail(job.data);
      await job.updateProgress(100);

      return {
        deliveredNoticeSentTo: job.data.customerEmail,
        orderId: job.data.orderId,
        sentAt: new Date().toISOString(),
      };
    }
  },
  {
    connection: bullRedis,
    concurrency: 5,
  },
);

// ── Event Listeners ──────────────────────────────────────
worker.on("completed", (job, result) => {
  workerLogger.info({ jobId: job.id, result }, "Email job completed");
});

worker.on("failed", (job, err) => {
  const jobId = job?.id ?? "unknown";
  const attempts = job?.attemptsMade ?? 0;
  workerLogger.error(
    {
      jobId,
      attempts,
      err: serializeError(err),
    },
    "Email job failed",
  );
});

worker.on("progress", (job, progress) => {
  workerLogger.info({ jobId: job.id, progress }, "Email job progress updated");
});

// Graceful shutdown — don't kill mid-job during deploys
process.on("SIGTERM", async () => {
  await worker.close();
});

workerLogger.info("Email worker is running and watching the queue");
