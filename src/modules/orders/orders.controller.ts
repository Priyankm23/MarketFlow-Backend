import { Request, Response } from "express";
import { OrderService } from "./orders.service.js";
import { OrderStatus } from "../../../generated/prisma/index.js";

export class OrderController {
  static async checkout(req: Request, res: Response) {
    const { deliveryPincode } = req.body;
    const orders = await OrderService.checkoutCart(req.user!.userId, deliveryPincode);
    
    res.status(201).json({
      status: "success",
      message: "Order placed successfully",
      data: orders
    });
  }

  static async getMyOrders(req: Request, res: Response) {
    const orders = await OrderService.getCustomerOrders(req.user!.userId);
    res.status(200).json({ status: "success", data: orders });
  }

  static async getVendorOrders(req: Request, res: Response) {
    // Only for vendors
    const orders = await OrderService.getVendorOrders(req.user!.userId);
    res.status(200).json({ status: "success", data: orders });
  }

  static async getOrderDetails(req: Request, res: Response) {
    const order = await OrderService.getOrderDetails(req.params.id, req.user!.userId, req.user!.role);
    res.status(200).json({ status: "success", data: order });
  }

  static async updateOrderStatus(req: Request, res: Response) {
    const { status, note } = req.body;
    // For Iteration 5, we allow vendor/admin to update status.
    // In real app, only VENDOR updates to PACKED, and DELIVERY_PARTNER to DELIVERED, etc.
    const updatedOrder = await OrderService.updateOrderStatus(
      req.params.id,
      status as OrderStatus,
      note
    );

    res.status(200).json({ status: "success", data: updatedOrder });
  }
}
