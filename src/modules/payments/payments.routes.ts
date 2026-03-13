import { Router } from "express";
import { PaymentController } from "./payments.controller.js";
import { requireAuth } from "../../core/middlewares/requireAuth.js";

export const paymentRoutes = Router();

// Endpoint for the frontend to ask for a checkout URL/Intent based on their current active order.
paymentRoutes.post("/:orderId/intent", requireAuth, PaymentController.initiate);

// The Webhook Listener that the Payment Gateway (Stripe/Razorpay) calls from the outside worldwide web.
// Notice there is NO requireAuth here because the caller is an external server, not the logged-in user.
paymentRoutes.post("/webhook", PaymentController.webhook);
