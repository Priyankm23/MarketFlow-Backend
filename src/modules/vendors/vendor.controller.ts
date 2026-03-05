import { Request, Response } from "express";
import { VendorService } from "./vendor.service.js";
import { ApiError } from "../../core/errors/ApiError.js";
import { uploadToCloudinary } from "../../core/utils/cloudinary.js";

export class VendorController {
  static async register(req: Request, res: Response) {
    if (
      !req.files ||
      Array.isArray(req.files) ||
      !req.files["govId"] ||
      !req.files["businessDoc"]
    ) {
      throw new ApiError(
        400,
        "Both 'govId' and 'businessDoc' files are required.",
      );
    }
    console.log(req.files);
    const govIdFile = req.files["govId"][0];
    const businessDocFile = req.files["businessDoc"][0];

    // Upload parallel for performance
    const [govIdUrl, businessDocUrl] = await Promise.all([
      uploadToCloudinary(govIdFile.buffer, "vendor_docs"),
      uploadToCloudinary(businessDocFile.buffer, "vendor_docs"),
    ]);

    const vendorData = {
      ...req.body,
      govIdUrl,
      businessDocUrl,
    };

    const vendor = await VendorService.registerVendor(
      req.user!.userId,
      vendorData,
    );
    res.status(201).json({ status: "success", data: vendor });
  }

  static async getProfile(req: Request, res: Response) {
    const vendor = await VendorService.getVendorProfile(req.user!.userId);
    res.status(200).json({ status: "success", data: vendor });
  }
}
