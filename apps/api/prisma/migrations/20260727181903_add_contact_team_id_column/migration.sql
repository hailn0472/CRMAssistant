-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'CONTACT_OWNER_CHANGED';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "teamId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_tenantId_teamId_idx" ON "Contact"("tenantId", "teamId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
