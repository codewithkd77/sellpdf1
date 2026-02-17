-- Make razorpay_order_id nullable to support free PDFs
-- Free PDFs don't need Razorpay orders since no payment is processed

ALTER TABLE purchases 
ALTER COLUMN razorpay_order_id DROP NOT NULL;
