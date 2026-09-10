-- Story 4.2: Automatic Activity Logging from Integrated Channels
--
-- AC 1-11: four new ActivityType members, four nullable Activity columns, the
-- dedupe unique constraint, and the new UserActivityLogPreference table.
--
-- AC 11 (critical): this migration MUST NOT write any row that uses a newly
-- added enum value. Postgres forbids *referencing* an ALTER TYPE ... ADD VALUE
-- member inside the same transaction, and Prisma wraps each migration in one.
-- ALTER TYPE + ADD COLUMN + CREATE TABLE only — no INSERTs with new values.

-- 1. ActivityType: exactly four new members (AC 1) — no member renamed/removed.
ALTER TYPE "ActivityType" ADD VALUE 'TASK_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE 'DEAL_STAGE_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE 'MESSAGE_RECEIVED';
ALTER TYPE "ActivityType" ADD VALUE 'MESSAGE_SENT';

-- 2. Activity: four nullable columns (AC 2) + dedupe unique (AC 6).
-- All nullable — existing rows have no value. Postgres treats NULLs as
-- distinct in unique indexes, so manual notes (dedupeKey = NULL) never collide.
ALTER TABLE "Activity" ADD COLUMN "source" TEXT;
ALTER TABLE "Activity" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "Activity" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Activity_tenantId_dedupeKey_key" ON "Activity"("tenantId", "dedupeKey");

-- 3. UserActivityLogPreference (AC 8-9). Shape mirrors UserReminderPreference.
-- CreateTable
CREATE TABLE "UserActivityLogPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "logTaskCompleted" BOOLEAN NOT NULL DEFAULT true,
    "logDealCreated" BOOLEAN NOT NULL DEFAULT true,
    "logDealStageChanged" BOOLEAN NOT NULL DEFAULT true,
    "logMessageSent" BOOLEAN NOT NULL DEFAULT true,
    "logMessageReceived" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserActivityLogPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserActivityLogPreference_userId_key" ON "UserActivityLogPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserActivityLogPreference_tenantId_userId_key" ON "UserActivityLogPreference"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "UserActivityLogPreference_tenantId_idx" ON "UserActivityLogPreference"("tenantId");

-- AddForeignKey
ALTER TABLE "UserActivityLogPreference" ADD CONSTRAINT "UserActivityLogPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivityLogPreference" ADD CONSTRAINT "UserActivityLogPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
