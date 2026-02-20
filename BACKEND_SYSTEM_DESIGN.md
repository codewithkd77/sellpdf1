# SellPDF Backend: System Design and API Relations

This document explains how the backend works end to end: architecture, database relations, API design, data flow, security model, and operational behavior.

## 1) High-Level Purpose

The backend powers a PDF marketplace where:

- users register/login
- sellers upload PDFs and list products
- buyers browse/search and purchase PDFs
- buyers get time-limited file access after payment
- sellers track earnings

Core stack:

- Node.js + Express
- PostgreSQL (relational data)
- Supabase Storage (private file storage)
- Razorpay (payments)
- JWT (authentication)

Key files:

- `backend/src/server.js`
- `backend/src/app.js`
- `backend/src/routes/*.js`
- `backend/src/services/*.js`
- `backend/src/database/schema.sql`

## 2) Runtime Architecture

## Request Path

1. Client sends HTTP request to Express.
2. Global middleware executes (`helmet`, `cors`, `morgan`, body parser).
3. Route matches under `/api/*` or `/share/*`.
4. Optional auth middleware validates JWT and sets `req.user`.
5. Controller calls service layer.
6. Service layer runs business logic + DB + external integrations.
7. Response is returned as JSON (or HTML for share page).
8. Errors propagate to centralized error handler.

## Components and Responsibilities

- `app.js`
  - wires middleware + route mounts
  - special-cases `/api/payment/webhook` with raw body parser
- `server.js`
  - DB connectivity check
  - schema initialization from `database/schema.sql`
  - starts HTTP listener
- `routes/*.js`
  - endpoint definitions and middleware chain
- `controllers/*.js`
  - HTTP orchestration (extract input, call service, return response)
- `services/*.js`
  - domain/business logic and data integration
- `database/pool.js`
  - singleton PG connection pool
- `middleware/*.js`
  - auth, validation, error handling

## 3) Data Model and Relations

Defined in `backend/src/database/schema.sql`.

## Tables

1. `users`
- columns: `id`, `name`, `email`, `password_hash`, `profile_picture`, timestamps
- unique: `email`

2. `pdf_products`
- columns: `id`, `seller_id`, `short_code`, `title`, `description`, `price`, `allow_download`, `file_path`, `file_size`, timestamps
- unique: `short_code`
- check: `price >= 0`

3. `purchases`
- columns: `id`, `buyer_id`, `product_id`, `razorpay_order_id`, `razorpay_payment_id`, `amount`, `status`, timestamps
- check: `status IN ('pending', 'paid', 'failed')`
- unique composite: `(buyer_id, product_id)` to prevent duplicate purchases by same buyer

4. `earnings`
- columns: `id`, `purchase_id`, `seller_id`, `total_amount`, `platform_fee`, `seller_amount`, `created_at`
- unique: `purchase_id` (one earnings row per purchase)

## Foreign-Key Relations

1. `pdf_products.seller_id -> users.id` (`ON DELETE CASCADE`)
- one seller can own many products

2. `purchases.buyer_id -> users.id` (`ON DELETE CASCADE`)
- one buyer can have many purchases

3. `purchases.product_id -> pdf_products.id` (`ON DELETE CASCADE`)
- one product can have many purchases

4. `earnings.purchase_id -> purchases.id` (`ON DELETE CASCADE`, unique)
- one purchase has exactly one earnings record

5. `earnings.seller_id -> users.id` (`ON DELETE CASCADE`)
- one seller has many earnings entries

## Relationship Summary (Cardinality)

- `users (seller)` 1 -> N `pdf_products`
- `users (buyer)` 1 -> N `purchases`
- `pdf_products` 1 -> N `purchases`
- `purchases` 1 -> 1 `earnings`
- `users (seller)` 1 -> N `earnings`

## 4) Authentication and Authorization Model

Files:

- `backend/src/services/auth.service.js`
- `backend/src/middleware/auth.middleware.js`
- `backend/src/validators/auth.validator.js`

## Auth Flow

1. Register:
- validate input (`name`, `email`, `password`)
- check duplicate email
- hash password with bcrypt (`SALT_ROUNDS = 12`)
- insert user
- issue JWT

2. Login:
- validate input
- fetch user by email
- bcrypt compare
- issue JWT

3. Protected routes:
- `Authorization: Bearer <token>`
- middleware verifies JWT signature and expiration
- decoded payload attached as `req.user`

JWT payload currently includes:

- `id`
- `email`

Note: role middleware exists (`authorize(...)`) but role is not currently embedded in token or enforced by routes.

## 5) Storage Design (Supabase)

Files:

- `backend/src/config/supabase.js`
- `backend/src/services/pdf.service.js`
- `backend/src/services/user.service.js`

Storage characteristics:

- Uses Supabase service-role key on backend.
- Bucket is treated as private.
- Files are addressed by storage path in DB.

File categories:

1. Product PDFs
- path pattern: `<sellerId>/<uuid>.pdf`
- stored in `pdf_products.file_path`

2. Profile pictures
- path pattern: `profiles/<userId>/<uuid>.<ext>`
- stored in `users.profile_picture`

Access model:

- product files are served via short-lived signed URLs (5 min)
- profile pictures are served via signed URLs (1 hour)
- no direct public storage URLs are persisted

## 6) Payment and Earnings Design

Files:

- `backend/src/services/payment.service.js`
- `backend/src/routes/payment.routes.js`
- `backend/src/controllers/payment.controller.js`

## Why Webhook-Centric Confirmation

The backend marks purchases as paid only from Razorpay webhook events (`payment.captured`), not from frontend callback trust. This reduces fraud risk from client-side spoofing.

## Paid Product Flow

1. Buyer calls `POST /api/payment/create-order` with `product_id`.
2. Backend fetches product and blocks self-purchase.
3. Backend checks existing purchase:
- if already paid -> 409 conflict
- if pending/failed exists -> deletes old row and recreates
4. Backend creates Razorpay order (amount in paise).
5. Backend inserts `purchases` row as `pending`.
6. Razorpay sends webhook.
7. Backend verifies HMAC signature using raw request body.
8. If valid and event is `payment.captured`:
- update purchase to `paid`
- save `razorpay_payment_id`
- compute commission:
  - `platform_fee = total_amount * commissionRate`
  - `seller_amount = total_amount - platform_fee`
- insert into `earnings`

## Free Product Flow

If product price is `0`:

- no Razorpay order
- `purchases` inserted directly as `paid`
- `earnings` inserted with zeros

Migrations supporting free flow:

- `backend/migrations/allow_free_pdfs.sql`
- `backend/migrations/fix_free_pdf_support.sql`

## 7) API Endpoint Reference

Base URL: `<host>/api` except share route.

## Health

1. `GET /health`
- auth: public
- response: `{ "status": "ok" }`

## Auth

1. `POST /api/auth/register`
- auth: public
- body:
```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "password": "secret123"
}
```
- response: `{ user, token }`

2. `POST /api/auth/login`
- auth: public
- body:
```json
{
  "email": "alice@example.com",
  "password": "secret123"
}
```
- response: `{ user, token }`

## PDF Products

1. `POST /api/pdf`
- auth: required
- content-type: `multipart/form-data`
- fields:
  - `file` (PDF, max 50 MB)
  - `title`
  - `description` (optional)
  - `price`
  - `allow_download` (`true|false`)
- behavior: uploads PDF + inserts product row

2. `GET /api/pdf/my`
- auth: required
- behavior: list seller-owned products

3. `GET /api/pdf/list?page=1&limit=20`
- auth: public
- behavior: paginated listing (newest first)

4. `GET /api/pdf/search?q=<text>`
- auth: public
- behavior: title/description/short_code search (case-insensitive)

5. `GET /api/pdf/code/:code`
- auth: public
- behavior: product lookup by short code

6. `GET /api/pdf/:id`
- auth: public
- behavior: product metadata with seller name

7. `GET /api/pdf/:id/access`
- auth: required
- behavior:
  - verifies buyer has paid purchase
  - returns signed URL + expiry + `allow_download`

8. `DELETE /api/pdf/:id`
- auth: required
- behavior:
  - seller-ownership check
  - delete DB product
  - attempt storage file removal

9. `PUT /api/pdf/:id/price`
- auth: required
- body:
```json
{ "price": 149.0 }
```
- behavior: seller-ownership check + price update

## Payments

1. `POST /api/payment/create-order`
- auth: required
- body:
```json
{ "product_id": "uuid" }
```
- response:
  - paid item: Razorpay order payload (`order_id`, `amount`, `currency`, `key`)
  - free item: `{ free: true, message: "Free PDF acquired successfully" }`

2. `POST /api/payment/webhook`
- auth: public endpoint, but cryptographically verified
- headers: `x-razorpay-signature`
- content-type: `application/json` raw body
- behavior: idempotent payment confirmation

## Purchases / Earnings

1. `GET /api/purchase/my`
- auth: required
- behavior: buyer purchase history with product and seller fields

2. `GET /api/purchase/earnings`
- auth: required
- behavior: seller earnings rows with product title

## User Profile

1. `GET /api/user/profile`
- auth: required
- behavior: profile + signed profile picture URL if exists

2. `PUT /api/user/profile/name`
- auth: required
- body:
```json
{ "name": "New Name" }
```

3. `POST /api/user/profile/picture`
- auth: required
- content-type: `multipart/form-data`
- field: `image` (image/*, max 5 MB)
- behavior: replace old picture, upload new, return signed URL

## Share Deep-Link

1. `GET /share/product/:id`
- auth: public
- returns HTML page (not JSON)
- use case: app deep-link and social preview card metadata

## 8) Validation and Error Handling

Validation:

- generic Joi middleware in `backend/src/middleware/validate.middleware.js`
- active schemas:
  - auth register/login
  - payment create-order
- note: PDF upload route currently relies on multer + service/DB checks rather than Joi route-level validation

Error handling:

- unknown route -> 404 JSON (`notFound`)
- centralized error middleware:
  - production: generic `Internal server error`
  - non-production: real message

## 9) Security Model

Implemented safeguards:

- password hashing with bcrypt
- JWT signature and expiry checks
- SQL parameterized queries
- private storage bucket + signed URLs
- webhook HMAC signature verification
- helmet/cors logging middleware
- duplicate purchase prevention via DB unique constraint
- self-purchase prevention

Operational security cautions:

- service-role key has high privilege; must stay server-side only
- webhook endpoint must remain raw-body compatible; normal JSON parser breaks signature verification
- `cors()` currently allows all origins; tighten for production if needed

## 10) Startup, Schema, and Deploy Behavior

Startup in `backend/src/server.js`:

1. checks DB connectivity (`SELECT 1`)
2. reads and runs `database/schema.sql` every boot (safe because `IF NOT EXISTS`)
3. binds host:
- production: `0.0.0.0`
- otherwise: `localhost`

Deployment template: `backend/render.yaml`
- includes env var list for DB, JWT, Supabase, Razorpay, commission rate

## 11) End-to-End Sequence Examples

## A) Upload and Sell PDF

1. Seller logs in -> gets JWT.
2. Seller uploads PDF (`POST /api/pdf` multipart).
3. Backend stores file in Supabase private bucket.
4. Backend inserts `pdf_products` row.
5. Product appears in `/api/pdf/list` and `/api/pdf/search`.

## B) Buy Paid PDF

1. Buyer calls `POST /api/payment/create-order`.
2. Backend inserts pending purchase + returns Razorpay order.
3. Buyer completes payment in Razorpay checkout.
4. Razorpay sends webhook (`payment.captured`).
5. Backend verifies signature, marks purchase paid, inserts earnings row.
6. Buyer can call `/api/pdf/:id/access` and receive signed URL.

## C) Buy Free PDF

1. Buyer calls `POST /api/payment/create-order`.
2. Backend detects price `0`.
3. Backend inserts paid purchase immediately.
4. Backend inserts zero-fee earnings.
5. Buyer can call `/api/pdf/:id/access` immediately.

## 12) Known Design Gaps / Improvement Opportunities

These are design observations, not failures:

1. Role-based authorization helper is defined but not actively used in routes.
2. `PUT /api/user/profile` is referenced in frontend service code, but backend exposes `PUT /api/user/profile/name`.
3. Frontend also references payment verification endpoint (`/api/payment/verify`) that backend does not expose; backend uses webhook confirmation.
4. Search and list queries are simple SQL `LIKE`; could evolve to full-text search if scale grows.
5. Share route builds HTML via string interpolation directly from DB fields; escaping strategy should be considered for strict XSS hardening.

## 13) Quick Glossary

- Signed URL: temporary URL granting private file access for limited time.
- Pending purchase: order created but not yet payment-confirmed.
- Webhook: server-to-server callback from payment provider.
- Earnings ledger: immutable financial record per successful purchase.

## 14) Source Map

Read these files in this order for fastest codebase understanding:

1. `backend/src/app.js`
2. `backend/src/routes/*.js`
3. `backend/src/controllers/*.js`
4. `backend/src/services/payment.service.js`
5. `backend/src/services/pdf.service.js`
6. `backend/src/services/auth.service.js`
7. `backend/src/database/schema.sql`
8. `backend/src/middleware/auth.middleware.js`
9. `backend/src/middleware/error.middleware.js`

