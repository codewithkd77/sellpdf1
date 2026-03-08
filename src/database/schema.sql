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
    is_banned       BOOLEAN         NOT NULL DEFAULT false,
    ban_reason      TEXT,
    banned_at       TIMESTAMPTZ,
    banned_by       VARCHAR(100),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by VARCHAR(100);

-- ─────────────────────────────────────────────
-- 2. PDF PRODUCTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pdf_products (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id       UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    short_code      VARCHAR(6)      NOT NULL UNIQUE,  -- 6-char human-friendly code
    title           VARCHAR(255)    NOT NULL,
    author_name     VARCHAR(255)    NOT NULL,
    description     TEXT,
    tags            TEXT[]          NOT NULL DEFAULT '{}',
    mrp             NUMERIC(10, 2)  CHECK (mrp IS NULL OR mrp >= 0),
    price           NUMERIC(10, 2)  NOT NULL CHECK (price >= 0),
    allow_download  BOOLEAN         NOT NULL DEFAULT false,
    is_active       BOOLEAN         NOT NULL DEFAULT true,
    file_path       TEXT            NOT NULL,       -- Supabase storage path: "pdfs/<seller_id>/<uuid>.pdf"
    cover_path      TEXT,                           -- Optional cover image storage path
    review_status   VARCHAR(30)     NOT NULL DEFAULT 'approved'
                                        CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by     VARCHAR(100),
    reviewed_at     TIMESTAMPTZ,
    file_size       BIGINT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_products_seller ON pdf_products(seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_products_short_code ON pdf_products(short_code);
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS cover_path TEXT;
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS mrp NUMERIC(10, 2);
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS author_name VARCHAR(255);
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'approved';
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100);
ALTER TABLE pdf_products ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
UPDATE pdf_products SET review_status = 'approved' WHERE review_status IS NULL;
CREATE INDEX IF NOT EXISTS idx_pdf_products_review_status ON pdf_products(review_status);

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

CREATE INDEX IF NOT EXISTS idx_purchases_buyer   ON purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_order   ON purchases(razorpay_order_id);

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

CREATE INDEX IF NOT EXISTS idx_earnings_seller   ON earnings(seller_id);
CREATE INDEX IF NOT EXISTS idx_earnings_purchase ON earnings(purchase_id);

-- ============================================================
-- 5. AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_type  VARCHAR(50)     NOT NULL,
    actor_id    VARCHAR(255),
    action      VARCHAR(120)    NOT NULL,
    target_type VARCHAR(80),
    target_id   VARCHAR(255),
    metadata    JSONB,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- ============================================================
-- 6. PDF REPORTS (copyright / policy reports)
-- ============================================================
CREATE TABLE IF NOT EXISTS pdf_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id      UUID REFERENCES pdf_products(id) ON DELETE SET NULL,
    product_title   TEXT            NOT NULL,
    reporter_id     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    reason_code     VARCHAR(50)     NOT NULL CHECK (
        reason_code IN (
          'copyright_infringement',
          'unauthorized_resale',
          'plagiarism_or_stolen_notes',
          'malware_or_harmful_file',
          'adult_or_illegal_content',
          'spam_or_misleading',
          'other'
        )
    ),
    custom_reason   TEXT,
    status          VARCHAR(30)     NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'under_review', 'resolved', 'dismissed')
    ),
    admin_note      TEXT,
    resolved_by     VARCHAR(100),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_reports_status ON pdf_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_reports_product ON pdf_reports(product_id);
CREATE INDEX IF NOT EXISTS idx_pdf_reports_reporter ON pdf_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_pdf_reports_seller ON pdf_reports(seller_id);
