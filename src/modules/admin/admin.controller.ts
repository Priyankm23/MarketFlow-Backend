import { Request, Response } from "express";
import { AdminService } from "./admin.service.js";

export class AdminController {
  static async getPendingVendors(req: Request, res: Response) {
    const vendors = await AdminService.getPendingVendors();
    res.status(200).json({ status: "success", data: vendors });
  }

  static async reviewVendor(req: Request, res: Response) {
    const { vendorId } = req.params;
    const { status } = req.body;
    const vendor = await AdminService.reviewVendor(vendorId, status);
    res.status(200).json({ status: "success", data: vendor });
  }
}
