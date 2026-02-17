-- Migration: Allow free PDFs (price = 0)
-- Drop the old constraint that requires price > 0
-- Add new constraint that allows price >= 0

ALTER TABLE pdf_products 
DROP CONSTRAINT IF EXISTS pdf_products_price_check;

ALTER TABLE pdf_products 
ADD CONSTRAINT pdf_products_price_check CHECK (price >= 0);
