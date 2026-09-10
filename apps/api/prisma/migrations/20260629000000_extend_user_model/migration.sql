-- AlterTable: rename 'name' to 'firstName', add 'lastName' and new profile fields
ALTER TABLE "User"
  RENAME COLUMN "name" TO "firstName";

ALTER TABLE "User"
  ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';

ALTER TABLE "User"
  ADD COLUMN "avatar" TEXT;

ALTER TABLE "User"
  ADD COLUMN "phone" TEXT;

ALTER TABLE "User"
  ADD COLUMN "jobTitle" TEXT;

ALTER TABLE "User"
  ADD COLUMN "department" TEXT;

ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_tenantId_isActive_idx" ON "User"("tenantId", "isActive");
