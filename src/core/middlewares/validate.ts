import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { ApiError } from "../errors/ApiError.js";

export const validate = (schema: z.ZodTypeAny) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
        cookies: req.cookies,
      });

      const parsedObject = parsed as Record<string, unknown>;

      if (parsedObject.body !== undefined) req.body = parsedObject.body;
      if (parsedObject.query !== undefined)
        req.query = parsedObject.query as Request["query"];
      if (parsedObject.params !== undefined)
        req.params = parsedObject.params as Request["params"];
      if (parsedObject.cookies && typeof parsedObject.cookies === "object") {
        req.cookies = parsedObject.cookies as Request["cookies"];
      }

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
