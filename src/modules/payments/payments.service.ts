import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";
import crypto from "crypto";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
} from "../../../generated/prisma/index.js";

export class PaymentService {
  /**
   * Simulates initiating a payment intent with a payment gateway (Like Stripe/Razorpay)
   */
  static async initiatePayment(orderId: string, userId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.userId !== userId) {
      throw new ApiError(403, "Unauthorized access to this order");
    }

    if (order.status === OrderStatus.CONFIRMED) {
      throw new ApiError(
        400,
        "This order is confirmed for Cash on Delivery and does not require online payment",
      );
    }

    if (order.status !== OrderStatus.PAYMENT_PENDING) {
      throw new ApiError(
        400,
        `Cannot initiate payment. Order status is ${order.status}`,
      );
    }

    // Check if an initiated payment already exists to prevent duplicate intents
    let payment = await prisma.payment.findFirst({
      where: { orderId, status: PaymentStatus.INITIATED },
    });

    if (!payment) {
      payment = await prisma.payment.create({
        data: {
          orderId,
          amount: order.totalAmount,
          status: PaymentStatus.INITIATED,
          gatewayRef: `mock_txn_${crypto.randomUUID()}`,
        },
      });
    }

    // Return the mock checkout session details
    return {
      paymentId: payment.id,
      gatewayRef: payment.gatewayRef,
      amount: payment.amount,
      mockCheckoutUrl: `https://mock-gateway.com/checkout/${payment.gatewayRef}`,
    };
  }

  /**
   * Processes the simulated webhook from the mock gateway securely.
   * Includes strict Idempotency checks.
   */
  static async processWebhook(eventId: string, type: string, payload: any) {
    // 1. Idempotency Check: Have we seen this specific webhook event before?
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent) {
      console.log(
        `[Webhook] Event ${eventId} already processed. Safely ignoring.`,
      );
      return { status: "ignored", reason: "duplicate" };
    }

    // 2. Save the incoming event immediately
    await prisma.webhookEvent.create({
      data: {
        eventId,
        type,
        payload, // Store JSON payload for audit trails
      },
    });

    const transactionId = payload.transactionId;
    if (!transactionId) {
      throw new ApiError(400, "Missing transactionId in webhook payload");
    }

    // 3. Find the Payment record associated with this gateway transaction
    const payment = await prisma.payment.findUnique({
      where: { gatewayRef: transactionId },
    });

    if (!payment) {
      throw new ApiError(404, "Payment record not found for this transaction");
    }

    // 4. Handle Mock Success Event
    if (type === "payment.success") {
      if (payment.status === PaymentStatus.SUCCESS) {
        return { status: "already_paid" };
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // A. Mark Payment as SUCCESS
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.SUCCESS },
        });

        // B. Transition Order to CONFIRMED so vendor can proceed to packing flow
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.CONFIRMED },
        });

        // C. Record Audit Log for the Order progression
        await tx.orderEvent.create({
          data: {
            orderId: payment.orderId,
            status: OrderStatus.CONFIRMED,
            note: `Payment successful via webhook. Order confirmed. Txn: ${transactionId}`,
          },
        });

        // D. Secure the inventory (Mark the 15m reservations as definitively CONFIRMED)
        // This ensures inventoryCleanup.ts never touches this order again!
        await tx.inventoryReservation.updateMany({
          where: { orderId: payment.orderId, status: "RESERVED" },
          data: { status: "CONFIRMED" },
        });

        // E. Mark Webhook as formally processed
        await tx.webhookEvent.update({
          where: { eventId },
          data: { processed: true },
        });
      });

      return { status: "success" };
    }

    // 5. Handle Mock Failure Event
    if (type === "payment.failed") {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED },
        });

        await tx.webhookEvent.update({
          where: { eventId },
          data: { processed: true },
        });
      });

      // Notice: We do NOT cancel the order. It stays PAYMENT_PENDING so the user can try again
      // with a different card before the 15-minute inventory lock timer expires.
      return { status: "failed_recorded" };
    }

    return { status: "unhandled_event_type" };
  }
}
