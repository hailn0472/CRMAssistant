-- Story 6.8: Activity Reports & Team Productivity Metrics
-- Hand-written additive migration:
--   1. New ActivityGoalPeriod enum + tenant-scoped ActivityGoal table with
--      FKs (Tenant/User CASCADE), its indexes and the race-safe partial
--      unique index (Contract A1-A5).
--   2. New ReportExportSourceType enum + sourceType column (default/backfill
--      SAVED_REPORT) + nullable reportId + the source CHECK constraint
--      (Contract A6-A8) — existing 6.6 export rows keep reportId, semantics
--      and history byte-for-byte.
-- Preserves all existing Activity/Task/TimeEntry/Deal/Report/ReportExport
-- rows — no drops, no recreates, no data backfills beyond the additive
-- SAVED_REPORT default.

-- CreateEnum
CREATE TYPE "ActivityGoalPeriod" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportExportSourceType" AS ENUM ('SAVED_REPORT', 'ACTIVITY_REPORT');

-- AlterTable (additive — every existing 6.6 export row becomes SAVED_REPORT
-- via the column default; reportId stays non-null for those rows)
ALTER TABLE "ReportExport" ADD COLUMN "sourceType" "ReportExportSourceType" NOT NULL DEFAULT 'SAVED_REPORT';

-- AlterTable (reportId becomes nullable for ACTIVITY_REPORT rows; the FK and
-- cascade semantics for SAVED_REPORT rows are unchanged)
ALTER TABLE "ReportExport" ALTER COLUMN "reportId" DROP NOT NULL;

-- AddCheckConstraint
-- The source discriminator invariant is structural: a SAVED_REPORT row must
-- reference a report; an ACTIVITY_REPORT row must not. Any insert/update
-- violating this fails at the DB before the application layer can drift.
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_source_check" CHECK (
  ("sourceType" = 'SAVED_REPORT' AND "reportId" IS NOT NULL)
  OR ("sourceType" = 'ACTIVITY_REPORT' AND "reportId" IS NULL)
);

-- CreateTable
CREATE TABLE "ActivityGoal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activityType" "ActivityType",
    "targetCount" INTEGER NOT NULL,
    "period" "ActivityGoalPeriod" NOT NULL,
    "userId" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ActivityGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityGoal_tenantId_idx" ON "ActivityGoal"("tenantId");

-- CreateIndex
CREATE INDEX "ActivityGoal_tenantId_userId_idx" ON "ActivityGoal"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "ActivityGoal_tenantId_isActive_idx" ON "ActivityGoal"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "ActivityGoal_tenantId_activityType_idx" ON "ActivityGoal"("tenantId", "activityType");

-- CreateIndex
CREATE INDEX "ActivityGoal_tenantId_userId_isActive_idx" ON "ActivityGoal"("tenantId", "userId", "isActive");

-- CreateIndex
-- Race-safe backstop for "one active goal per (user, period, activityType)":
-- the service also checks, but two concurrent creates cannot both slip
-- through. The invariant is expressed as TWO partial unique indexes with no
-- cast — a single COALESCE(activityType::text, ...) index expression is
-- REJECTED by PostgreSQL (42P17: enum→text cast is STABLE, not IMMUTABLE).
--   * typed goals: unique on (tenantId, userId, period, activityType) where
--     activityType IS NOT NULL — the NULL-typed rows never participate;
--   * TOTAL goals (activityType = NULL): unique on (tenantId, userId,
--     period) where activityType IS NULL — NULLs are distinct in plain
--     unique indexes, so this dedicated partial index is what makes two
--     concurrent TOTAL goals collide.
-- Soft-deleted/inactive goals free their slot (partial predicate).
CREATE UNIQUE INDEX "ActivityGoal_tenantId_userId_period_activityType_key" ON "ActivityGoal"("tenantId", "userId", "period", "activityType") WHERE "deletedAt" IS NULL AND "isActive" = TRUE AND "activityType" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ActivityGoal_tenantId_userId_period_total_key" ON "ActivityGoal"("tenantId", "userId", "period") WHERE "deletedAt" IS NULL AND "isActive" = TRUE AND "activityType" IS NULL;

-- AddForeignKey
ALTER TABLE "ActivityGoal" ADD CONSTRAINT "ActivityGoal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityGoal" ADD CONSTRAINT "ActivityGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
