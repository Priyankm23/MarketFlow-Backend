// src/config/env.ts
import dotenv from "dotenv";
import type { StringValue } from "ms";
import { get } from "node:http";

dotenv.config();

function getEnvVariable(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",

  PORT: Number(process.env.PORT ?? 5000),

  DATABASE_URL: getEnvVariable("DATABASE_URL"),

  JWT_ACCESS_SECRET: getEnvVariable("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: getEnvVariable("JWT_REFRESH_SECRET"),

  ACCESS_TOKEN_EXPIRES_IN: (process.env.ACCESS_TOKEN_EXPIRES_IN ??
    "15m") as StringValue,

  REFRESH_TOKEN_EXPIRES_IN: (process.env.REFRESH_TOKEN_EXPIRES_IN ??
    "7d") as StringValue,

  CLOUDINARY_CLOUD_NAME: getEnvVariable("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: getEnvVariable("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: getEnvVariable("CLOUDINARY_API_SECRET"),

  CORS_ORIGIN: getEnvVariable("CORS_ORIGIN"),
  REDIS_URL: getEnvVariable("REDIS_URL"),

  SMTP_HOST: getEnvVariable("SMTP_SERVER"),
  SMTP_PORT: getEnvVariable("SMTP_PORT"),
  SMTP_USER: getEnvVariable("SMTP_USER"),
  SMTP_PASS: getEnvVariable("SMTP_PASS"),

  APP_HELP_URL: process.env.APP_HELP_URL?.trim() || "",
  APP_FEEDBACK_URL: process.env.APP_FEEDBACK_URL?.trim() || "",

  MARKIVO_LOGO_URL: getEnvVariable("MARKIVO_LOGO_URL"),

  EXPECTED_DB_HOST: process.env.EXPECTED_DB_HOST?.trim() || undefined,
  EXPECTED_DB_NAME: process.env.EXPECTED_DB_NAME?.trim() || undefined,

  // Flash deal auto-approval thresholds
  FLASH_DEAL_AUTO_APPROVE_MIN_RATING: Number(
    process.env.FLASH_DEAL_AUTO_APPROVE_MIN_RATING ?? 3.5,
  ),
  FLASH_DEAL_AUTO_APPROVE_MIN_REVIEWS: Number(
    process.env.FLASH_DEAL_AUTO_APPROVE_MIN_REVIEWS ?? 3,
  ),

  STRIPE_SECRET_KEY: getEnvVariable("STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: getEnvVariable("STRIPE_WEBHOOK_SECRET"),

  ELASTIC_NODE: getEnvVariable("elastic_node"),
  ELASTIC_API_KEY: getEnvVariable("elastic_api_key"),
  ELASTIC_PRODUCTS_INDEX:
    process.env.ELASTIC_PRODUCTS_INDEX?.trim() || "products",
};
