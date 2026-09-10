-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "forecastValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commitValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bestCaseValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pipelineValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dealCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastSnapshot_tenantId_idx" ON "ForecastSnapshot"("tenantId");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_tenantId_periodStart_idx" ON "ForecastSnapshot"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastSnapshot_tenantId_periodStart_snapshotDate_key" ON "ForecastSnapshot"("tenantId", "periodStart", "snapshotDate");

-- AddForeignKey
ALTER TABLE "ForecastSnapshot" ADD CONSTRAINT "ForecastSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
