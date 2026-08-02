-- CreateTable
CREATE TABLE "DealReminder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "healthStatus" TEXT NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "sweepDate" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DealReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealReminderSnooze" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snoozedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DealReminderSnooze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReminderPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailFrequency" TEXT NOT NULL DEFAULT 'DAILY',
    "notifyNoActivity" BOOLEAN NOT NULL DEFAULT true,
    "notifyClosingSoon" BOOLEAN NOT NULL DEFAULT true,
    "notifyAtRisk" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserReminderPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealReminder_tenantId_dealId_reason_sweepDate_key" ON "DealReminder"("tenantId", "dealId", "reason", "sweepDate");

-- CreateIndex
CREATE INDEX "DealReminder_tenantId_idx" ON "DealReminder"("tenantId");

-- CreateIndex
CREATE INDEX "DealReminder_tenantId_userId_sweepDate_idx" ON "DealReminder"("tenantId", "userId", "sweepDate");

-- CreateIndex
CREATE INDEX "DealReminder_tenantId_dealId_idx" ON "DealReminder"("tenantId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "DealReminderSnooze_tenantId_dealId_userId_key" ON "DealReminderSnooze"("tenantId", "dealId", "userId");

-- CreateIndex
CREATE INDEX "DealReminderSnooze_tenantId_idx" ON "DealReminderSnooze"("tenantId");

-- CreateIndex
CREATE INDEX "DealReminderSnooze_tenantId_userId_idx" ON "DealReminderSnooze"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserReminderPreference_tenantId_userId_key" ON "UserReminderPreference"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserReminderPreference_userId_key" ON "UserReminderPreference"("userId");

-- CreateIndex
CREATE INDEX "UserReminderPreference_tenantId_idx" ON "UserReminderPreference"("tenantId");

-- CreateIndex
CREATE INDEX "Deal_tenantId_expectedCloseDate_idx" ON "Deal"("tenantId", "expectedCloseDate");

-- AddForeignKey
ALTER TABLE "DealReminder" ADD CONSTRAINT "DealReminder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealReminder" ADD CONSTRAINT "DealReminder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealReminder" ADD CONSTRAINT "DealReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealReminderSnooze" ADD CONSTRAINT "DealReminderSnooze_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealReminderSnooze" ADD CONSTRAINT "DealReminderSnooze_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealReminderSnooze" ADD CONSTRAINT "DealReminderSnooze_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReminderPreference" ADD CONSTRAINT "UserReminderPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReminderPreference" ADD CONSTRAINT "UserReminderPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
