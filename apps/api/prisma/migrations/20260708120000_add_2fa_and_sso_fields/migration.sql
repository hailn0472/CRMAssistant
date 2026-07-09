-- AlterTable: Add 2FA fields to User
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "twoFactorSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "twoFactorBackupCodes" JSONB;
ALTER TABLE "User" ADD COLUMN "ssoProvider" TEXT;
ALTER TABLE "User" ADD COLUMN "ssoId" TEXT;

-- AlterTable: Add enforce2FA to Tenant
ALTER TABLE "Tenant" ADD COLUMN "enforce2FA" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: Composite unique for SSO link per tenant+provider
CREATE UNIQUE INDEX "User_tenantId_ssoProvider_ssoId_key" ON "User"("tenantId", "ssoProvider", "ssoId");
