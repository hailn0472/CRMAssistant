-- Story 6.6: Report Export in Multiple Formats (FR45)
-- Hand-written additive migration: creates the ReportExportStatus enum, the
-- tenant-scoped ReportExport history table with its indexes/FKs, and the
-- nullable Notification.reportExportId target column + FK + index.
-- Preserves all existing Report, ReportSchedule, Notification, Tenant and
-- User rows — no drops, no recreates, no data backfills.

-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "format" "ReportDeliveryFormat" NOT NULL,
    "status" "ReportExportStatus" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB,
    "filterSummary" TEXT NOT NULL,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "filename" TEXT,
    "contentType" TEXT,
    "objectPath" TEXT,
    "fileSizeBytes" INTEGER,
    "expectedTotalRows" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportExport_tenantId_userId_createdAt_idx" ON "ReportExport"("tenantId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ReportExport_status_nextRetryAt_createdAt_idx" ON "ReportExport"("status", "nextRetryAt", "createdAt");

-- CreateIndex
CREATE INDEX "ReportExport_tenantId_reportId_createdAt_idx" ON "ReportExport"("tenantId", "reportId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (additive — existing notification rows keep NULL target)
ALTER TABLE "Notification" ADD COLUMN "reportExportId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_reportExportId_idx" ON "Notification"("reportExportId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reportExportId_fkey" FOREIGN KEY ("reportExportId") REFERENCES "ReportExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
