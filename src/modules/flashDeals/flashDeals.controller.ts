import { Request, Response } from "express";
import FlashDealsService from "./flashDeals.service.js";
import { ApiError } from "../../core/errors/ApiError.js";

export class FlashDealsController {
  static async getActive(req: Request, res: Response) {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 6;
    const deals = await FlashDealsService.getActiveFlashDeals(limit);
    res.status(200).json({ status: "success", data: deals });
  }

  static async create(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) throw new ApiError(401, "Unauthorized");
      const body = req.body;
      const created = await FlashDealsService.createOffer(user.userId, {
        productId: body.productId,
        discountPercentage: Number(body.discountPercentage),
        startAt: new Date(body.startAt),
        endAt: new Date(body.endAt),
        offerName: body.offerName,
        couponCode: body.couponCode ?? null,
        termsAndConditions: body.termsAndConditions ?? null,
      });
      res.status(201).json({ status: "success", data: created });
    } catch (err: any) {
      throw err instanceof ApiError
        ? err
        : new ApiError(400, err.message || "Invalid request");
    }
  }

  static async listPending(req: Request, res: Response) {
    const pending = await FlashDealsService.listPendingOffers();
    res.status(200).json({ status: "success", data: pending });
  }

  static async approve(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) throw new ApiError(401, "Unauthorized");
      const offerId = req.params.id;
      const updated = await FlashDealsService.approveOffer(
        user.userId,
        offerId,
      );
      res.status(200).json({ status: "success", data: updated });
    } catch (err: any) {
      throw err instanceof ApiError
        ? err
        : new ApiError(400, err.message || "Cannot approve offer");
    }
  }

  static async reject(req: Request, res: Response) {
    try {
      const user = req.user;
      if (!user) throw new ApiError(401, "Unauthorized");
      const offerId = req.params.id;
      const { reason } = req.body;
      const updated = await FlashDealsService.rejectOffer(
        user.userId,
        offerId,
        reason,
      );
      res.status(200).json({ status: "success", data: updated });
    } catch (err: any) {
      throw err instanceof ApiError
        ? err
        : new ApiError(400, err.message || "Cannot reject offer");
    }
  }
}

export default FlashDealsController;
