import { Request, Response } from "express";
import { OrderService } from "./orders.service.js";
import { OrderStatus } from "../../../generated/prisma/index.js";

export class OrderController {
  static async checkout(req: Request, res: Response) {
    const { shippingAddress, paymentMode } = req.body;
    const orders = await OrderService.checkoutCart(
      req.user!.userId,
      shippingAddress,
      paymentMode,
    );

    res.status(201).json({
      status: "success",
      message: "Order placed successfully",
      data: orders,
    });
  }

  static async getMyOrders(req: Request, res: Response) {
    const orders = await OrderService.getCustomerOrders(req.user!.userId);
    res.status(200).json({ status: "success", data: orders });
  }

  static async getLastShippingAddress(req: Request, res: Response) {
    const shippingAddress = await OrderService.getLastOrderShippingAddress(
      req.user!.userId,
    );

    res.status(200).json({ status: "success", data: shippingAddress });
  }

  static async getVendorOrders(req: Request, res: Response) {
    // Only for vendors
    const orders = await OrderService.getVendorOrders(req.user!.userId);
    res.status(200).json({ status: "success", data: orders });
  }

  static async markReadyForDelivery(req: Request, res: Response) {
    const orderId = Array.isArray(req.params.orderId)
      ? req.params.orderId[0]
      : req.params.orderId;

    if (!orderId) {
      res.status(400).json({ status: "fail", message: "Order ID is required" });
      return;
    }

    const updatedOrder = await OrderService.markReadyForDelivery(
      orderId,
      req.user!.userId,
    );

    res.status(200).json({
      status: "success",
      message: "Order marked ready for delivery",
      data: updatedOrder,
    });
  }

  static async getOrderDetails(req: Request, res: Response) {
    const orderId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    if (!orderId) {
      res.status(400).json({ status: "fail", message: "Order ID is required" });
      return;
    }

    const order = await OrderService.getOrderDetails(
      orderId,
      req.user!.userId,
      req.user!.role,
    );
    res.status(200).json({ status: "success", data: order });
  }

  static async updateOrderStatus(req: Request, res: Response) {
    const { status, note } = req.body;
    const orderId = Array.isArray(req.params.orderId)
      ? req.params.orderId[0]
      : req.params.orderId;

    if (!orderId) {
      res.status(400).json({ status: "fail", message: "Order ID is required" });
      return;
    }

    // For Iteration 5, we allow vendor/admin to update status.
    // In real app, only VENDOR updates to PACKED, and DELIVERY_PARTNER to DELIVERED, etc.
    const updatedOrder = await OrderService.updateOrderStatus(
      orderId,
      status as OrderStatus,
      note,
    );

    res.status(200).json({ status: "success", data: updatedOrder });
  }
}
