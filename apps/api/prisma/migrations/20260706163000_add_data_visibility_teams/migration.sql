-- CreateEnum
CREATE TYPE "DataVisibility" AS ENUM ('OWN', 'TEAM', 'ALL');

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add teamId to User
ALTER TABLE "User" ADD COLUMN "teamId" TEXT;

-- AlterTable: Add dataVisibility to Role
ALTER TABLE "Role" ADD COLUMN "dataVisibility" "DataVisibility" NOT NULL DEFAULT 'OWN';

-- AlterTable: Add ownerId to Contact
ALTER TABLE "Contact" ADD COLUMN "ownerId" TEXT NOT NULL DEFAULT 'system';

-- CreateIndex
CREATE INDEX "Team_tenantId_idx" ON "Team"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_tenantId_name_key" ON "Team"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Contact_tenantId_ownerId_idx" ON "Contact"("tenantId", "ownerId");

-- CreateIndex: Add missing unique constraint on Contact
DROP INDEX IF EXISTS "Contact_tenantId_email_key";
CREATE UNIQUE INDEX "Contact_tenantId_email_key" ON "Contact"("tenantId", "email");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
