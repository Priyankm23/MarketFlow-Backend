import { Request, Response } from "express";
import { CartService } from "./cart.service.js";

export class CartController {
  static async getCart(req: Request, res: Response) {
    const cart = await CartService.getCart(req.user!.userId);
    res.status(200).json({ status: "success", data: cart });
  }

  static async addItem(req: Request, res: Response) {
    const { productId, quantity } = req.body;
    const cart = await CartService.addItem(req.user!.userId, productId, quantity);
    res.status(200).json({ status: "success", data: cart });
  }

  static async updateItem(req: Request, res: Response) {
    const productId = Array.isArray(req.params.productId)
      ? req.params.productId[0]
      : req.params.productId;
    const { quantity } = req.body;
    if (!productId) {
      res.status(400).json({ status: "fail", message: "Product ID required" });
      return;
    }

    const cart = await CartService.updateItemQuantity(req.user!.userId, productId, quantity);
    res.status(200).json({ status: "success", data: cart });
  }

  static async removeItem(req: Request, res: Response) {
    const productId = Array.isArray(req.params.productId)
      ? req.params.productId[0]
      : req.params.productId;

    if (!productId) {
      res.status(400).json({ status: "fail", message: "Product ID required" });
      return;
    }

    const cart = await CartService.removeItem(req.user!.userId, productId);
    res.status(200).json({ status: "success", data: cart });
  }

  static async clearCart(req: Request, res: Response) {
    await CartService.clearCart(req.user!.userId);
    res.status(200).json({ status: "success", message: "Cart cleared" });
  }
}
