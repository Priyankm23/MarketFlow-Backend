import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { errorHandler } from "./core/errors/errorHandler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import userRoutes from "./modules/users/user.routes.js";
import vendorRoutes from "./modules/vendors/vendor.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import productRoutes from "./modules/products/product.routes.js";
import { cartRoutes } from "./modules/cart/cart.routes.js";
import { orderRoutes } from "./modules/orders/orders.routes.js";
import { paymentRoutes } from "./modules/payments/payments.routes.js";
import { deliveryRoutes } from "./modules/delivery/delivery.routes.js";

const app = express();

// Some versions of `helmet` export differently under ESM; handle both shapes.
const _helmet: any = helmet;
const helmetMiddleware = _helmet.default ?? _helmet;
app.use(helmetMiddleware());
app.use(morgan("dev")); // Request logging
// Configure CORS to explicitly allow the frontend and handle preflight
const allowedOrigins = new Set<string>();
if (process.env.CORS_ORIGIN) allowedOrigins.add(process.env.CORS_ORIGIN);
if (process.env.NODE_ENV === "production") {
  allowedOrigins.add("https://marketflow-your-one-stop-shop.vercel.app");
} else {
  // allow localhost during development
  allowedOrigins.add("http://localhost:3000");
  allowedOrigins.add("http://127.0.0.1:3000");
}

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // allow non-browser requests with no origin (server-to-server, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("CORS origin denied"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
// Ensure preflight requests are handled
app.options("/*", cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// API Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/vendors", vendorRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/delivery", deliveryRoutes);

// Health Check endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

app.use(errorHandler);

export default app;
