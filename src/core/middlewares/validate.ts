import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { ApiError } from "../errors/ApiError.js";

export const validate = (schema: z.ZodTypeAny) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
        cookies: req.cookies,
      });
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        return next(new ApiError(400, `Validation Error: ${message}`));
      }
      return next(error);
    }
  };
};
