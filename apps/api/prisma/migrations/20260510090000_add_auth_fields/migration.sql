-- Migration: add_auth_fields
-- Story 1.7: Implement Authentication System (Supabase Auth + JWT)
--
-- Changes:
--   1. Add UserRole enum
--   2. Add role column to User table (defaults to SALES_REP)
--   3. Add supabaseUserId column to User table (nullable, unique)
--   4. Add index on supabaseUserId for fast lookups

-- Create UserRole enum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'SALES_REP');

-- Add role column with default
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'SALES_REP';

-- Add supabaseUserId column (nullable unique)
ALTER TABLE "User" ADD COLUMN "supabaseUserId" TEXT;

-- Add unique constraint on supabaseUserId
ALTER TABLE "User" ADD CONSTRAINT "User_supabaseUserId_key" UNIQUE ("supabaseUserId");

-- Add index on supabaseUserId for fast lookups
CREATE INDEX "User_supabaseUserId_idx" ON "User"("supabaseUserId");
