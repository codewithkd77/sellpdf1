ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by VARCHAR(100);

CREATE TABLE IF NOT EXISTS pdf_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES pdf_products(id) ON DELETE SET NULL,
  product_title TEXT NOT NULL,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason_code VARCHAR(50) NOT NULL CHECK (
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
  custom_reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'under_review', 'resolved', 'dismissed')
  ),
  admin_note TEXT,
  resolved_by VARCHAR(100),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_reports_status ON pdf_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_reports_product ON pdf_reports(product_id);
CREATE INDEX IF NOT EXISTS idx_pdf_reports_reporter ON pdf_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_pdf_reports_seller ON pdf_reports(seller_id);
