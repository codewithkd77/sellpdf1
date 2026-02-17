-- ============================================================
-- NoteBay — Full Database Schema
-- ============================================================
-- Run this against your local PostgreSQL 'sellpdf' database.
--
-- Commission logic:
--   platform_fee  = price × 0.10
--   seller_amount = price × 0.90
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- 1. USERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100)    NOT NULL,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    password_hash   TEXT            NOT NULL,
    profile_picture TEXT,                          -- Supabase storage path
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ─────────────────────────────────────────────
-- 2. PDF PRODUCTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pdf_products (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id       UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    short_code      VARCHAR(6)      NOT NULL UNIQUE,  -- 6-char human-friendly code
    title           VARCHAR(255)    NOT NULL,
    description     TEXT,
    price           NUMERIC(10, 2)  NOT NULL CHECK (price >= 0),
    allow_download  BOOLEAN         NOT NULL DEFAULT false,
    file_path       TEXT            NOT NULL,       -- Supabase storage path: "pdfs/<seller_id>/<uuid>.pdf"
    file_size       BIGINT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pdf_products_seller ON pdf_products(seller_id);
CREATE UNIQUE INDEX idx_pdf_products_short_code ON pdf_products(short_code);

-- ─────────────────────────────────────────────
-- 3. PURCHASES
-- ─────────────────────────────────────────────
-- Unique constraint on (buyer_id, product_id) prevents duplicate purchases.
CREATE TABLE IF NOT EXISTS purchases (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_id            UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id          UUID            NOT NULL REFERENCES pdf_products(id) ON DELETE CASCADE,
    razorpay_order_id   VARCHAR(255),   -- Nullable for free PDFs
    razorpay_payment_id VARCHAR(255),
    amount              NUMERIC(10, 2)  NOT NULL,
    status              VARCHAR(20)     NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'paid', 'failed')),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_buyer_product UNIQUE (buyer_id, product_id)
);

CREATE INDEX idx_purchases_buyer   ON purchases(buyer_id);
CREATE INDEX idx_purchases_product ON purchases(product_id);
CREATE INDEX idx_purchases_order   ON purchases(razorpay_order_id);

-- ─────────────────────────────────────────────
-- 4. EARNINGS (commission ledger)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS earnings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id     UUID            NOT NULL REFERENCES purchases(id) ON DELETE CASCADE UNIQUE,
    seller_id       UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount    NUMERIC(10, 2)  NOT NULL,
    platform_fee    NUMERIC(10, 2)  NOT NULL,    -- total_amount × 0.10
    seller_amount   NUMERIC(10, 2)  NOT NULL,    -- total_amount × 0.90
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_earnings_seller   ON earnings(seller_id);
CREATE INDEX idx_earnings_purchase ON earnings(purchase_id);
