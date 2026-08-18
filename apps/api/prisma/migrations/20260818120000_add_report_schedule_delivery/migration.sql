-- Story 6.5: Scheduled Report Delivery via Email (FR44)
-- Hand-written additive migration: creates schedule/execution tables, enums,
-- tenant branding columns and FK relations. Preserves all existing Report,
-- Tenant, User and Notification rows — no drops or recreates.
--
-- Prisma models: ReportSchedule, ReportScheduleExecution; Tenant.logoUrl,
-- Tenant.primaryColor; inverse collections on Tenant/User/Report.

-- CreateEnum
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM_CRON');

-- CreateEnum
CREATE TYPE "ReportDeliveryFormat" AS ENUM ('PDF', 'EXCEL', 'CSV');

-- CreateEnum
CREATE TYPE "ReportScheduleExecutionStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- AlterTable (additive tenant branding — Story 6.5 AC 12)
ALTER TABLE "Tenant" ADD COLUMN "logoUrl" TEXT,
ADD COLUMN "primaryColor" TEXT;

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "frequency" "ReportScheduleFrequency" NOT NULL,
    "recipients" TEXT[] NOT NULL,
    "format" "ReportDeliveryFormat" NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "startMonth" INTEGER,
    "cronExpression" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportScheduleExecution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReportScheduleExecutionStatus" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportScheduleExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSchedule_tenantId_idx" ON "ReportSchedule"("tenantId");

-- CreateIndex
CREATE INDEX "ReportSchedule_tenantId_userId_deletedAt_idx" ON "ReportSchedule"("tenantId", "userId", "deletedAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_isActive_deletedAt_nextRunAt_idx" ON "ReportSchedule"("isActive", "deletedAt", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_tenantId_reportId_deletedAt_idx" ON "ReportSchedule"("tenantId", "reportId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportScheduleExecution_scheduleId_scheduledFor_key" ON "ReportScheduleExecution"("scheduleId", "scheduledFor");

-- CreateIndex
CREATE INDEX "ReportScheduleExecution_status_nextRetryAt_idx" ON "ReportScheduleExecution"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "ReportScheduleExecution_tenantId_scheduleId_createdAt_idx" ON "ReportScheduleExecution"("tenantId", "scheduleId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportScheduleExecution" ADD CONSTRAINT "ReportScheduleExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportScheduleExecution" ADD CONSTRAINT "ReportScheduleExecution_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportScheduleExecution" ADD CONSTRAINT "ReportScheduleExecution_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
