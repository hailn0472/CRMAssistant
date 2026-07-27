-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('EMAIL_SENT', 'CALL_MADE', 'MEETING_SCHEDULED', 'NOTE_ADDED', 'DEAL_CREATED', 'CONTACT_CREATED', 'CONTACT_UPDATED');

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_tenantId_idx" ON "Activity"("tenantId");

-- CreateIndex
CREATE INDEX "Activity_tenantId_contactId_idx" ON "Activity"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "Activity_tenantId_contactId_createdAt_idx" ON "Activity"("tenantId", "contactId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Activity_tenantId_createdBy_idx" ON "Activity"("tenantId", "createdBy");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
