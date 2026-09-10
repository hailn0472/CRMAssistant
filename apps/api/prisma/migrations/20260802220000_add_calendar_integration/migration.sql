-- Story 4.3: Calendar Integration (Google Calendar & Outlook)
--
-- AC 1-11: two new enums (CalendarProvider, CalendarSyncStatus), the
-- per-user CalendarConnection model, the TaskCalendarEvent link model and the
-- UserActivityLogPreference.logMeetingScheduled column.
--
-- AC 7: TaskCalendarEvent has NO deletedAt — it is hard-deleted (soft delete +
-- @@unique reserves the key forever; see DealStage trap). The schema doc
-- comment restates this exemption.
--
-- AC 11: all FK ON DELETE decisions are explicit CASCADE. logMeetingScheduled
-- is added with DEFAULT true AND NOT NULL — safe because the default backfills
-- existing rows (the nullable-column rule applies only to columns without a
-- default).
--
-- Both enums are NEW types, so the ALTER TYPE ... ADD VALUE transaction trap
-- does not apply. No INSERTs in this migration.

-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'OUTLOOK');

-- CreateEnum
CREATE TYPE "CalendarSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- AlterTable (AC 8): new preference column with a default, so NOT NULL is safe.
ALTER TABLE "UserActivityLogPreference" ADD COLUMN "logMeetingScheduled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalAccountEmail" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "syncToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCalendarEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "calendarConnectionId" TEXT NOT NULL,
    "externalEventId" TEXT,
    "syncStatus" "CalendarSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "localSyncedAt" TIMESTAMP(3),
    "conflictDetectedAt" TIMESTAMP(3),
    "conflictSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',

    CONSTRAINT "TaskCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_tenantId_userId_provider_key" ON "CalendarConnection"("tenantId", "userId", "provider");

-- CreateIndex
CREATE INDEX "CalendarConnection_tenantId_idx" ON "CalendarConnection"("tenantId");

-- CreateIndex
CREATE INDEX "CalendarConnection_tenantId_userId_idx" ON "CalendarConnection"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCalendarEvent_tenantId_taskId_calendarConnectionId_key" ON "TaskCalendarEvent"("tenantId", "taskId", "calendarConnectionId");

-- CreateIndex
CREATE INDEX "TaskCalendarEvent_tenantId_idx" ON "TaskCalendarEvent"("tenantId");

-- CreateIndex
CREATE INDEX "TaskCalendarEvent_tenantId_syncStatus_nextAttemptAt_idx" ON "TaskCalendarEvent"("tenantId", "syncStatus", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "TaskCalendarEvent_calendarConnectionId_externalEventId_idx" ON "TaskCalendarEvent"("calendarConnectionId", "externalEventId");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCalendarEvent" ADD CONSTRAINT "TaskCalendarEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCalendarEvent" ADD CONSTRAINT "TaskCalendarEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCalendarEvent" ADD CONSTRAINT "TaskCalendarEvent_calendarConnectionId_fkey" FOREIGN KEY ("calendarConnectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
