import dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined in environment variables");
}

export const pool = new Pool({
  connectionString,
  max: 10, // number of connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: false, // Required for Neon
  },
});

pool.on("connect", () => {
  console.log("✅ PostgreSQL pool connected");
});

pool.on("error", (err) => {
  console.error("❌ Unexpected PG Pool Error:", err);
  process.exit(1);
});
