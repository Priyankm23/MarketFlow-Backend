// src/config/env.ts
import dotenv from "dotenv";
import type { StringValue } from "ms";

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
};
