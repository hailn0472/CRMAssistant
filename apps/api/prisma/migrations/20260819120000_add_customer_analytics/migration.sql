-- Story 6.7: Customer Lifetime Value & Churn Risk Analysis (FR47)
-- Hand-written additive migration:
--   1. Contact gains nullable server-owned calculated analytics fields + the
--      three filter/sort indexes (Contract A1-A2).
--   2. Task gains nullable internal-only automation identity + a tenant-scoped
--      unique on automationKey (Contract A4).
--   3. New tenant-scoped CustomerAnalyticsSnapshot daily materialization table
--      with FKs (Tenant/Contact CASCADE, Task SET NULL) and its indexes
--      (Contract A3).
-- Preserves all existing Contact/Deal/Task/Report rows — no drops, no
-- recreates, no data backfills (Contract A5-A6: uncalculated rows keep NULL).

-- AlterTable (additive — existing contact rows keep NULL calculated fields)
ALTER TABLE "Contact" ADD COLUMN "lifetimeValue" DOUBLE PRECISION;
ALTER TABLE "Contact" ADD COLUMN "churnRisk" TEXT;
ALTER TABLE "Contact" ADD COLUMN "churnRiskScore" DOUBLE PRECISION;
ALTER TABLE "Contact" ADD COLUMN "lastActivityDate" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "analyticsCalculatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Contact_tenantId_churnRisk_idx" ON "Contact"("tenantId", "churnRisk");

-- CreateIndex
CREATE INDEX "Contact_tenantId_lifetimeValue_idx" ON "Contact"("tenantId", "lifetimeValue");

-- CreateIndex
CREATE INDEX "Contact_tenantId_lastActivityDate_idx" ON "Contact"("tenantId", "lastActivityDate");

-- AlterTable (additive — existing task rows keep NULL automation identity)
ALTER TABLE "Task" ADD COLUMN "automationSource" TEXT;
ALTER TABLE "Task" ADD COLUMN "automationKey" TEXT;

-- CreateIndex
-- Postgres treats NULLs as distinct in unique indexes, so NULL automationKey
-- rows (all existing tasks) never collide; a deterministic non-null key makes
-- the same trigger idempotent even after the task is soft-deleted.
CREATE UNIQUE INDEX "Task_tenantId_automationKey_key" ON "Task"("tenantId", "automationKey");

-- CreateTable
CREATE TABLE "CustomerAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCohort" TEXT NOT NULL,
    "lifetimeValue" DOUBLE PRECISION NOT NULL,
    "churnRiskScore" DOUBLE PRECISION NOT NULL,
    "churnRisk" TEXT NOT NULL,
    "lastActivityDate" TIMESTAMP(3),
    "inactivityRisk" DOUBLE PRECISION NOT NULL,
    "dealWinRate" DOUBLE PRECISION NOT NULL,
    "engagementScore" DOUBLE PRECISION NOT NULL,
    "wonDealCount" INTEGER NOT NULL,
    "lostDealCount" INTEGER NOT NULL,
    "qualifyingActivityCount" INTEGER NOT NULL,
    "churnPreventionTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAnalyticsSnapshot_tenantId_contactId_snapshotDate_key" ON "CustomerAnalyticsSnapshot"("tenantId", "contactId", "snapshotDate");

-- CreateIndex
CREATE INDEX "CustomerAnalyticsSnapshot_tenantId_snapshotDate_idx" ON "CustomerAnalyticsSnapshot"("tenantId", "snapshotDate");

-- CreateIndex
CREATE INDEX "CustomerAnalyticsSnapshot_tenantId_acquisitionCohort_snapsh_idx" ON "CustomerAnalyticsSnapshot"("tenantId", "acquisitionCohort", "snapshotDate");

-- CreateIndex
CREATE INDEX "CustomerAnalyticsSnapshot_tenantId_churnRisk_snapshotDate_idx" ON "CustomerAnalyticsSnapshot"("tenantId", "churnRisk", "snapshotDate");

-- CreateIndex
CREATE INDEX "CustomerAnalyticsSnapshot_tenantId_contactId_snapshotDate_idx" ON "CustomerAnalyticsSnapshot"("tenantId", "contactId", "snapshotDate" DESC);

-- CreateIndex
CREATE INDEX "CustomerAnalyticsSnapshot_tenantId_idx" ON "CustomerAnalyticsSnapshot"("tenantId");

-- AddForeignKey
ALTER TABLE "CustomerAnalyticsSnapshot" ADD CONSTRAINT "CustomerAnalyticsSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAnalyticsSnapshot" ADD CONSTRAINT "CustomerAnalyticsSnapshot_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAnalyticsSnapshot" ADD CONSTRAINT "CustomerAnalyticsSnapshot_churnPreventionTaskId_fkey" FOREIGN KEY ("churnPreventionTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
