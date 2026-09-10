-- B2C lead qualification belongs to Contact, independently from products and
-- deals. Existing customers are safely initialized as NEW; score, decision
-- rationale and qualification audit values intentionally begin as NULL.

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'REVIEWING', 'NURTURING', 'QUALIFIED_LEAD', 'NOT_A_LEAD');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "leadStatus" "LeadStatus" NOT NULL DEFAULT 'NEW';
ALTER TABLE "Contact" ADD COLUMN "leadScore" DOUBLE PRECISION;
ALTER TABLE "Contact" ADD COLUMN "qualificationReason" TEXT;
ALTER TABLE "Contact" ADD COLUMN "qualifiedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "qualifiedBy" TEXT;

-- CreateIndex
CREATE INDEX "Contact_tenantId_leadStatus_idx" ON "Contact"("tenantId", "leadStatus");
CREATE INDEX "Contact_tenantId_leadScore_idx" ON "Contact"("tenantId", "leadScore");
