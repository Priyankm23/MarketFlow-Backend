# MarketFlow — Multi-Vendor E-Commerce Backend

> A multi-vendor marketplace and order management system connecting customers, vendors, and delivery partners — built in TypeScript with a focus on checkout correctness, async task isolation, and clean domain boundaries.

**Live Platform →** [Marketflow - your one stop shop](https://marketflow-your-one-stop-shop.vercel.app/)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-black?style=flat-square&logo=express)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-635BFF?style=flat-square&logo=stripe&logoColor=white)

---

## What is MarketFlow?

MarketFlow is a backend for a multi-vendor marketplace where customers browse and purchase products, vendors manage their own storefronts and inventory, delivery partners fulfill orders within their coverage pincodes, and admins oversee the platform. The core engineering focus is on checkout correctness under concurrency, a well-defined order lifecycle, and keeping async work off the request thread.

---

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  ┌───────────┐
│  Customer   │  │   Vendor    │  │ Delivery Partner │  │   Admin   │
└──────┬──────┘  └──────┬──────┘  └──────── ┬────────┘  └─────┬─────┘
       │                │                   │                 │
       └────────────────┴───────────────────┴─────────────────┘
                                    │
                          REST API (Express.js)
                          JWT · Role-based RBAC
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
       ┌──────▼──────┐    ┌─────────▼────────┐    ┌────────▼───────┐
       │  PostgreSQL │    │  Redis + BullMQ  │    │   Stripe API   │
       │  via Prisma │    │  (job queues)    │    │   Webhooks     │
       │  (Neon DB)  │    └──────────────────┘    └────────────────┘
       └─────────────┘
              │
   ┌──────────┴──────────┐
   │     Cloudinary      │
   │  (image storage)    │
   └─────────────────────┘
```

---

## Features

### Auth & User Management
- Single `User` table with polymorphic roles: `CUSTOMER`, `VENDOR`, `DELIVERY_PARTNER`, `ADMIN`
- JWT-based auth with a separate expiring `Session` table — refresh tokens are stored and can be individually revoked (`isRevoked` flag)
- Bcrypt password hashing; role-specific middleware guards on all protected routes

### Vendor Onboarding & Management
- Vendors register with business name, store category, physical address, tax ID, and government/business document uploads (Cloudinary)
- Admin approval workflow: `PENDING → APPROVED / REJECTED / SUSPENDED`
- Vendors manage their own product catalog, inventory, and offers independently

### Product Catalog
- Products belong to a vendor and a category, with support for multiple image URLs (Cloudinary), warranty info, and return policy
- Filtered, paginated product listing for customers
- **Materialized rating summaries** — `ProductRatingSummary` stores pre-aggregated star counts and comment buckets per product, avoiding expensive `GROUP BY` queries on every catalog load. Updated on each review write.
- One review per user per product (`@@unique([userId, productId])`); reviews support image attachments

### Offers & Flash Deals
- Vendors propose offers with discount percentage, optional coupon code, terms, and optional time window (`startAt` / `endAt`)
- Flash deals require **admin approval** before becoming visible to customers (`OfferApprovalStatus`: `PENDING → APPROVED / REJECTED`)
- Composite index on `(isFlashDeal, approvalStatus, startAt, endAt)` for efficient active deal queries

### Cart & Checkout
- One cart per user; cart items enforce `@@unique([cartId, productId])` to prevent duplicates
- On checkout: cart is locked, **inventory is temporarily reserved** via `InventoryReservation` with an `expiresAt` TTL, and a Stripe payment intent is created — stock is not deducted until payment confirms
- This reservation gap prevents overselling under concurrent checkouts without requiring a distributed lock

### Order Lifecycle & OMS
- Full state machine: `CREATED → PAYMENT_PENDING → PAID → CONFIRMED → PACKED → READY_FOR_PICKUP → OUT_FOR_DELIVERY → DELIVERED` (plus `CANCELLED` / `REFUNDED`)
- Every status transition writes an `OrderEvent` record — full audit trail of who moved the order and when
- **Price snapshotting** — `OrderItem` stores `price`, `gstRate`, `gstAmount`, and `lineTotal` at the time of purchase. Later price changes on the product don't affect historical order data.
- Fee breakdown on every order: `subtotal`, `platformFee`, `deliveryFee`, `gstAmount`, `offerDiscount`, `totalAmount`
- Full shipping address captured on the order record

### Payments (Stripe)
- Stripe payment intents created at checkout; webhook confirms payment and triggers inventory deduction + order status update
- **Idempotency keys** on `Payment` records (`@@unique`) — duplicate Stripe webhook deliveries are detected via `WebhookEvent` deduplication table and ignored, preventing double-charges or double state transitions
- Payment statuses: `INITIATED → SUCCESS / FAILED / REFUNDED`

### Delivery Partner Assignment
- Delivery partners register with coverage pincodes and a daily capacity limit (`dailyCapacity`, `activeDeliveries`)
- Orders are dispatched to partners based on pincode match and available capacity

### Async Job Processing (BullMQ)
- Heavy tasks pushed to Redis-backed BullMQ queues and processed by a separate worker process: order confirmation emails (Resend), bulk inventory sync, scheduled health checks
- Main API thread never blocks on email delivery or background sync

---

## Key Engineering Decisions

**Inventory reservation over direct deduction** — Stock is reserved (not deducted) between checkout initiation and payment confirmation. Reservations have a TTL; if payment doesn't complete, the reservation expires and stock is automatically freed. This handles the race condition between concurrent checkouts on the same product without pessimistic locking on every request.

**Idempotent webhooks** — Every incoming Stripe webhook event is written to `WebhookEvent` with a unique `eventId`. Before processing, the system checks if that `eventId` already exists. Duplicate deliveries (common with Stripe) are dropped before any state change occurs.

**Materialized rating summaries** — Instead of `SELECT AVG(rating) ... GROUP BY productId` on every product load, ratings are pre-aggregated into `ProductRatingSummary` at write time. Catalog reads stay fast regardless of review volume.

**Price snapshotting on order items** — `OrderItem` stores a snapshot of `price` and `gstRate` at purchase time. Vendors can change product prices freely without corrupting historical order records or revenue reports.

**BullMQ worker isolation** — Email dispatch and background tasks run in a separate worker process (`npm run worker`), completely decoupled from the API server. The API enqueues jobs and returns immediately; the worker consumes independently.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Framework | Express.js v5 |
| Database | PostgreSQL (Neon Serverless) via Prisma ORM |
| Caching & Queues | Redis + BullMQ |
| Process Management | PM2 |
| Payments | Stripe |
| Image Storage | Cloudinary |
| Email | Resend |
| Validation | Zod |
| Security | Helmet, bcrypt |
| Logging | Pino, Morgan |

---

## Data Models

```
User (CUSTOMER | VENDOR | DELIVERY_PARTNER | ADMIN)
 ├── Session          (refresh tokens, revocable)
 ├── Vendor           (storefront, approval status, address, docs)
 ├── DeliveryPartner  (coverage pincodes, daily capacity)
 ├── Cart → CartItem
 ├── Order → OrderItem, Payment, InventoryReservation, OrderEvent
 └── ProductReview

Product
 ├── Category
 ├── Offer            (flash deals, admin approval flow)
 ├── ProductReview
 └── ProductRatingSummary  (materialized star counts + comment buckets)

WebhookEvent  (idempotency dedup table for Stripe)
```

---

## Running Locally

**Prerequisites:** Node.js 18+, PostgreSQL, Redis

```bash
git clone https://github.com/Priyankm23/MarketFlow-Backend.git
cd MarketFlow-Backend
npm install
```

Create `.env`:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/marketflow
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
RESEND_API_KEY=re_...
```

```bash
npm run db:migrate:deploy   # Run Prisma migrations
npx prisma generate         # Generate Prisma client

npm run dev                 # Development (hot reload)
npm run worker              # Start BullMQ worker (separate terminal)

npm run build && npm start  # Production (PM2)
```

---

## API Overview

| Domain | Key Endpoints |
|---|---|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` |
| Vendors | `POST /api/vendors` · vendor approval via admin |
| Products | `GET /api/products` · `POST /api/products` · `POST /api/products/:id/offers` |
| Cart | `GET/POST/DELETE /api/cart` |
| Orders | `POST /api/orders/checkout` · `PATCH /api/orders/:id/status` |
| Payments | `POST /api/webhooks/stripe` |
| Reviews | `POST /api/products/:id/reviews` |
| Admin | vendor approval · offer approval · platform stats |

---

*Open source.*
