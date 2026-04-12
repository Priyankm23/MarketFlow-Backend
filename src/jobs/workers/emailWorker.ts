import { Worker } from "bullmq";
import { bullRedis } from "../../config/redis.js";
import {
  sendOrderPlacedInvoiceEmail,
  sendWelcomeEmail,
} from "../../core/utils/emailService.js";
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

const worker = new Worker(
  "emailQueue",
  async (job) => {
    console.log(`⚙️  Processing job [${job.id}]: ${job.name}`);

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
  },
  {
    connection: bullRedis,
    concurrency: 5,
  },
);

// ── Event Listeners ──────────────────────────────────────
worker.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} done →`, result);
});

worker.on("failed", (job, err) => {
  const jobId = job?.id ?? "unknown";
  const attempts = job?.attemptsMade ?? 0;
  console.error(`❌ Job ${jobId} failed (attempt ${attempts}):`, err.message);
});

worker.on("progress", (job, progress) => {
  console.log(`🔄 Job ${job.id} is ${progress}% done`);
});

// Graceful shutdown — don't kill mid-job during deploys
process.on("SIGTERM", async () => {
  await worker.close();
});

console.log("👷 Email worker is running and watching the queue...");
