import { Request, Response, NextFunction } from "express";
import { DeliveryService } from "./delivery.service.js";
import { ApiError } from "../../core/errors/ApiError.js";

export class DeliveryController {
  // GET /api/v1/delivery/profile
  static async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const profile = await DeliveryService.getPartnerProfile(userId);

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/v1/delivery/coverage-pincodes
  static async getCoveragePincodes(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const userId = req.user!.userId;
      const coveragePincodes =
        await DeliveryService.getCoveragePincodes(userId);

      res.status(200).json({
        success: true,
        data: {
          coveragePincodes,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/v1/delivery/profile
  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId; // from requireAuth
      const { coveragePincodes, dailyCapacity } = req.body;

      if (!Array.isArray(coveragePincodes)) {
        throw new ApiError(400, "coveragePincodes must be an array of strings");
      }

      const partner = await DeliveryService.registerPartner(
        userId,
        coveragePincodes,
        dailyCapacity,
      );

      res.status(200).json({
        success: true,
        message: "Delivery profile updated",
        data: partner,
      });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/v1/delivery/tasks/assigned
  static async getAssignedTasks(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const userId = req.user!.userId;
      const tasks = await DeliveryService.getAssignedTasks(userId);

      res.status(200).json({
        success: true,
        data: tasks,
      });
    } catch (error) {
      next(error);
    }
  }

  // POST /api/v1/delivery/orders/:orderId/respond
  static async respondToAssignment(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const userId = req.user!.userId;
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;

      if (!orderId) {
        throw new ApiError(400, "Order ID is required");
      }

      if (typeof req.body.accept !== "boolean") {
        throw new ApiError(400, "accept must be a boolean value");
      }

      const result = await DeliveryService.respondToAssignment(
        orderId,
        userId,
        req.body.accept,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/v1/delivery/orders/:orderId/assign
  // (Usually triggered internally, but an admin could trigger it manually)
  static async triggerAssignment(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;

      if (!orderId) {
        throw new ApiError(400, "Order ID is required");
      }

      const result = await DeliveryService.assignOrderToPartner(orderId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/v1/delivery/orders/:orderId/complete
  static async markDelivered(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const orderId = Array.isArray(req.params.orderId)
        ? req.params.orderId[0]
        : req.params.orderId;

      if (!orderId) {
        throw new ApiError(400, "Order ID is required");
      }

      const result = await DeliveryService.completeDelivery(orderId, userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
