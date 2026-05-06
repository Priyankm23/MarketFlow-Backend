import { Request, Response, NextFunction } from "express";
import { ApiError } from "./ApiError.js";
import { env } from "../../config/env.js";
import { logger, serializeError } from "../utils/logger.js";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const statusCode = 500;
    const message = error.message || "Internal Server Error";
    error = new ApiError(statusCode, message, false, err.stack);
  }

  const { statusCode, message } = error as ApiError;

  logger.error(
    {
      err: serializeError(err),
      statusCode,
      method: req.method,
      path: req.originalUrl,
      requestId: res.getHeader("x-request-id") || req.headers["x-request-id"],
    },
    "Request failed",
  );

  res.status(statusCode).json({
    status: "error",
    statusCode,
    message,
    ...(env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
