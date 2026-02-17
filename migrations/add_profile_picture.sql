-- Migration: Add profile_picture column to users table
-- Run this against your PostgreSQL database

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT;
