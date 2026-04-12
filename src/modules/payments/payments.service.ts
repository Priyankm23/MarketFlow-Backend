import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { emailQueue } from "../../jobs/queues/queue.js";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
} from "../../../generated/prisma/index.js";
import Stripe from "stripe";
import { stripe } from "./stripe.service.js";
import { env } from "../../config/env.js";

export class PaymentService {
  /**
   * Creates or reuses a Stripe PaymentIntent for the order.
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

    const amount = Number(order.totalAmount);
    const amountInSmallestUnit = Math.round(amount * 100);

    if (!Number.isFinite(amountInSmallestUnit) || amountInSmallestUnit <= 0) {
      throw new ApiError(400, "Invalid order amount for payment intent");
    }

    // Check if an initiated payment already exists to prevent duplicate intents.
    let payment = await prisma.payment.findFirst({
      where: { orderId, status: PaymentStatus.INITIATED },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) {
      payment = await prisma.payment.create({
        data: {
          orderId,
          amount: order.totalAmount,
          status: PaymentStatus.INITIATED,
        },
      });
    }

    if (payment.gatewayRef) {
      try {
        const existingIntent = await stripe.paymentIntents.retrieve(
          payment.gatewayRef,
        );

        if (existingIntent.client_secret) {
          return {
            paymentId: payment.id,
            gatewayRef: existingIntent.id,
            amount: payment.amount,
            clientSecret: existingIntent.client_secret,
            publishableKeyHint: "Use STRIPE_PUBLISHABLE_KEY in frontend",
          };
        }
      } catch {
        // Intent may have been canceled or deleted; create a fresh one.
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount: amountInSmallestUnit,
      currency: "inr",
      metadata: {
        orderId: order.id,
        userId,
        paymentId: payment.id,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    payment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        gatewayRef: intent.id,
      },
    });

    // Return details frontend needs for Stripe confirmation.
    return {
      paymentId: payment.id,
      gatewayRef: intent.id,
      amount: payment.amount,
      clientSecret: intent.client_secret,
      publishableKeyHint: "Use STRIPE_PUBLISHABLE_KEY in frontend",
    };
  }

  static constructWebhookEvent(payload: Buffer, signature: string) {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  }

  /**
   * Processes Stripe webhook events with strict idempotency checks.
   * Includes strict Idempotency checks.
   */
  static async processWebhook(event: Stripe.Event) {
    const eventId = event.id;
    const type = event.type;
    const payload = event.data.object;
    const payloadJson = JSON.parse(
      JSON.stringify(payload),
    ) as Prisma.InputJsonValue;

    // 1. Idempotency Check: Ignore only if already fully processed.
    let existingEvent = await prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent?.processed) {
      console.log(
        `[Webhook] Event ${eventId} already processed. Safely ignoring.`,
      );
      return { status: "ignored", reason: "duplicate" };
    }

    // 2. Save the incoming event immediately (or continue if an unprocessed one already exists)
    if (!existingEvent) {
      try {
        existingEvent = await prisma.webhookEvent.create({
          data: {
            eventId,
            type,
            payload: payloadJson, // Store JSON payload for audit trails
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          existingEvent = await prisma.webhookEvent.findUnique({
            where: { eventId },
          });

          if (existingEvent?.processed) {
            return { status: "ignored", reason: "duplicate" };
          }
        } else {
          throw error;
        }
      }
    }

    if (
      type !== "payment_intent.succeeded" &&
      type !== "payment_intent.payment_failed"
    ) {
      await prisma.webhookEvent.update({
        where: { eventId },
        data: { processed: true },
      });
      return { status: "unhandled_event_type" };
    }

    const intent = payload as Stripe.PaymentIntent;
    const transactionId = intent.id;
    const paymentIdFromMetadata = intent.metadata?.paymentId;
    const orderIdFromMetadata = intent.metadata?.orderId;

    let payment = await prisma.payment.findUnique({
      where: { gatewayRef: transactionId },
    });

    if (!payment && paymentIdFromMetadata) {
      payment = await prisma.payment.findUnique({
        where: { id: paymentIdFromMetadata },
      });

      if (payment && payment.gatewayRef !== transactionId) {
        payment = await prisma.payment.update({
          where: { id: payment.id },
          data: { gatewayRef: transactionId },
        });
      }
    }

    if (!payment && orderIdFromMetadata) {
      payment = await prisma.payment.findFirst({
        where: {
          orderId: orderIdFromMetadata,
          status: PaymentStatus.INITIATED,
        },
        orderBy: { createdAt: "desc" },
      });

      if (payment) {
        payment = await prisma.payment.update({
          where: { id: payment.id },
          data: { gatewayRef: transactionId },
        });
      }
    }

    if (!payment) {
      throw new ApiError(404, "Payment record not found for this transaction");
    }

    // 4. Handle Stripe success event
    if (type === "payment_intent.succeeded") {
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
            note: `Payment successful via Stripe webhook. Order confirmed. Txn: ${transactionId}`,
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

      const orderForInvoice = await prisma.order.findUnique({
        where: { id: payment.orderId },
        include: {
          vendor: { select: { businessName: true } },
          items: {
            include: {
              product: { select: { name: true } },
            },
          },
        },
      });

      if (orderForInvoice?.shippingEmail) {
        const shippingAddressParts = [
          orderForInvoice.shippingAddressLine1,
          orderForInvoice.shippingAddressLine2,
          orderForInvoice.shippingCity,
          orderForInvoice.shippingState,
          orderForInvoice.shippingPostalCode,
        ].filter((part): part is string => Boolean(part && part.trim()));

        await emailQueue.add(
          "order-placed-invoice-email",
          {
            orderId: orderForInvoice.id,
            customerName: orderForInvoice.shippingFullName || "Customer",
            customerEmail: orderForInvoice.shippingEmail,
            vendorName: orderForInvoice.vendor.businessName,
            orderDate: orderForInvoice.createdAt.toISOString(),
            paymentReference: transactionId,
            totalAmount: Number(orderForInvoice.totalAmount),
            shippingAddress: shippingAddressParts.join(", "),
            items: orderForInvoice.items.map((item) => {
              const unitPrice = Number(item.price);
              return {
                productName: item.product.name,
                quantity: item.quantity,
                unitPrice,
                lineTotal: unitPrice * item.quantity,
              };
            }),
          },
          {
            jobId: `order-invoice-${orderForInvoice.id}-${eventId}`,
          },
        );
      }

      return { status: "success" };
    }

    // 5. Handle Stripe failure event
    if (type === "payment_intent.payment_failed") {
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
