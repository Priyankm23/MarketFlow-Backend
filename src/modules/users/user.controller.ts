import { Request, Response } from "express";
import { UserService } from "./user.service.js";

export class UserController {
  static async getProfile(req: Request, res: Response) {
    // req.user is guaranteed by requireAuth middleware
    const profile = await UserService.getProfile(req.user!.userId);
    res.status(200).json({ status: "success", data: profile });
  }

  static async updateProfile(req: Request, res: Response) {
    const updatedProfile = await UserService.updateProfile(req.user!.userId, req.body);
    res.status(200).json({ status: "success", data: updatedProfile });
  }
}
