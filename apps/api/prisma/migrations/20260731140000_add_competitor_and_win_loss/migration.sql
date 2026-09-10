-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "strengths" TEXT,
    "weaknesses" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealCompetitor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DealCompetitor_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN "winLossReason" TEXT,
ADD COLUMN "winLossNote" TEXT,
ADD COLUMN "competitorId" TEXT;

-- CreateIndex
CREATE INDEX "Competitor_tenantId_idx" ON "Competitor"("tenantId");

-- CreateIndex
CREATE INDEX "Competitor_tenantId_isActive_idx" ON "Competitor"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "DealCompetitor_tenantId_idx" ON "DealCompetitor"("tenantId");

-- CreateIndex
CREATE INDEX "DealCompetitor_tenantId_dealId_idx" ON "DealCompetitor"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "DealCompetitor_dealId_deletedAt_idx" ON "DealCompetitor"("dealId", "deletedAt");

-- CreateIndex
CREATE INDEX "DealCompetitor_tenantId_competitorId_idx" ON "DealCompetitor"("tenantId", "competitorId");

-- CreateIndex
CREATE INDEX "Deal_tenantId_winLossReason_idx" ON "Deal"("tenantId", "winLossReason");

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealCompetitor" ADD CONSTRAINT "DealCompetitor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealCompetitor" ADD CONSTRAINT "DealCompetitor_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealCompetitor" ADD CONSTRAINT "DealCompetitor_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
