-- Story 4.5: Time Tracking & Productivity Reports
--
-- AC 1-2: the TimeEntry model — full multi-tenancy house pattern (tenantId,
-- createdBy/updatedBy, deletedAt, @@index([tenantId])) plus a per-user,
-- per-task time record. durationSeconds is an INTEGER column: the row's
-- single source of truth for length (AC 10/AC 22); the epic's unit-ambiguous
-- `duration` is arbitrated to durationSeconds.
--
-- AC 1/AC 6: NO @@unique constraint anywhere. "One active timer per user" is
-- enforced in TimeEntriesService inside a Serializable interactive
-- transaction (mapping Postgres P2034 to a 409 Conflict) — a partial unique
-- index (WHERE "endTime" IS NULL) cannot be expressed in schema.prisma and
-- would break `prisma migrate diff` forever, while a plain @@unique is the
-- documented soft-delete trap (a soft-deleted row reserves its key forever).
--
-- AC 1: no @db.* native types (zero exist in the whole schema). The
-- @@index([tenantId, userId, endTime]) index serves the running-timer lookup
-- (endTime IS NULL — NULLs are indexed in Postgres B-trees); the
-- @@index([tenantId, userId, startTime]) index serves the report's range
-- scan (NFR11: 10M activities per tenant).
--
-- No new enum, no change to Task/Activity or any existing column (AC 5). No
-- INSERTs in this migration.

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_idx" ON "TimeEntry"("tenantId");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_userId_startTime_idx" ON "TimeEntry"("tenantId", "userId", "startTime");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_taskId_idx" ON "TimeEntry"("tenantId", "taskId");

-- CreateIndex
CREATE INDEX "TimeEntry_tenantId_userId_endTime_idx" ON "TimeEntry"("tenantId", "userId", "endTime");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
