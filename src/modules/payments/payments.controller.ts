import { Request, Response, NextFunction } from "express";
import { PaymentService } from "./payments.service.js";

export class PaymentController {
  // POST /api/payments/:orderId/intent
  static async initiate(req: Request, res: Response, next: NextFunction) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;
      const userId = req.user!.userId; // Captured from requireAuth middleware

      if (!orderId) {
        res.status(400).json({ success: false, message: "Order ID is required" });
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
  static async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      // Typically provided by Stripe/Razorpay directly in the JSON POST
      const { eventId, type, data } = req.body;

      if (!eventId || !type || !data) {
        res.status(400).json({
          success: false,
          message: "Invalid webhook payload structure",
        });
        return;
      }

      const result = await PaymentService.processWebhook(eventId, type, data);

      // Payment gateways expect a fast 200 OK signal so they stop retrying
      res.status(200).json({
        success: true,
        result,
      });
    } catch (error) {
      // Returning a 500 prompts the external gateway to retry sending the webhook later
      console.error("[Webhook Processing Error]:", error);
      res.status(500).json({
        success: false,
        message: "Webhook processing failed",
      });
    }
  }
}
