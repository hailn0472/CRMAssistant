-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('READ', 'EDIT', 'FULL');
-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('CONTACT', 'DEAL', 'TASK');
-- CreateTable
CREATE TABLE "SharingRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "sharedWithUserId" TEXT,
    "sharedWithTeamId" TEXT,
    "accessLevel" "AccessLevel" NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "SharingRule_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "SharingRule_tenantId_resourceType_resourceId_idx" ON "SharingRule"("tenantId", "resourceType", "resourceId");
-- CreateIndex
CREATE INDEX "SharingRule_tenantId_sharedWithUserId_idx" ON "SharingRule"("tenantId", "sharedWithUserId");
-- CreateIndex
CREATE INDEX "SharingRule_tenantId_sharedWithTeamId_idx" ON "SharingRule"("tenantId", "sharedWithTeamId");
-- CreateIndex
CREATE INDEX "SharingRule_tenantId_resourceType_sharedWithUserId_idx" ON "SharingRule"("tenantId", "resourceType", "sharedWithUserId");
-- AddForeignKey
ALTER TABLE "SharingRule" ADD CONSTRAINT "SharingRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SharingRule" ADD CONSTRAINT "SharingRule_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SharingRule" ADD CONSTRAINT "SharingRule_sharedWithTeamId_fkey" FOREIGN KEY ("sharedWithTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
