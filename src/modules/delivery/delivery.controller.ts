import { Request, Response, NextFunction } from "express";
import { DeliveryService } from "./delivery.service.js";
import { ApiError } from "../../core/errors/ApiError.js";

export class DeliveryController {
  
  // POST /api/v1/delivery/profile
  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id; // from requireAuth
      const { coveragePincodes, dailyCapacity } = req.body;

      if (!Array.isArray(coveragePincodes)) {
        throw new ApiError(400, "coveragePincodes must be an array of strings");
      }

      const partner = await DeliveryService.registerPartner(userId, coveragePincodes, dailyCapacity);

      res.status(200).json({
        success: true,
        message: "Delivery profile updated",
        data: partner
      });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/v1/delivery/orders/:orderId/assign
  // (Usually triggered internally, but an admin could trigger it manually)
  static async triggerAssignment(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const result = await DeliveryService.assignOrderToPartner(orderId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/v1/delivery/orders/:orderId/complete
  static async markDelivered(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { orderId } = req.params;

      const result = await DeliveryService.completeDelivery(orderId, userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}