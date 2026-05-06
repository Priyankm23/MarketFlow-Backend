import { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import { PaymentService } from "./payments.service.js";
import { logger, serializeError } from "../../core/utils/logger.js";

const paymentsControllerLogger = logger.child({ component: "payments-controller" });

export class PaymentController {
  // POST /api/payments/:orderId/intent
  static async initiate(req: Request, res: Response, next: NextFunction) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const userId = req.user!.userId; // Captured from requireAuth middleware

      if (!orderId) {
        res
          .status(400)
          .json({ success: false, message: "Order ID is required" });
        return;
      }

      const intent = await PaymentService.initiatePayment(orderId, userId);

      res.status(200).json({
        success: true,
        message: "Payment intent initiated",
        data: intent,
      });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/payments/webhook
  static async webhook(req: Request, res: Response, _next: NextFunction) {
    try {
      const signatureHeader = req.headers["stripe-signature"];
      const signature = Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : signatureHeader;

      if (!signature) {
        res.status(400).json({
          success: false,
          message: "Missing Stripe signature header",
        });
        return;
      }

      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body ?? {}));

      const event = PaymentService.constructWebhookEvent(rawBody, signature);
      const result = await PaymentService.processWebhook(event);

      // Payment gateways expect a fast 200 OK signal so they stop retrying
      res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        res.status(400).json({
          success: false,
          message: error.message,
        });
        return;
      }

      // Returning a 500 prompts the external gateway to retry sending the webhook later
      paymentsControllerLogger.error(
        { err: serializeError(error) },
        "Webhook processing failed",
      );
      res.status(500).json({
        success: false,
        message: "Webhook processing failed",
      });
    }
  }
}
