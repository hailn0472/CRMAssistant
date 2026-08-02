-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "assignedTo" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "defaultPriority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "defaultDueInDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_tenantId_idx" ON "Task"("tenantId");

-- CreateIndex
CREATE INDEX "Task_tenantId_assignedTo_idx" ON "Task"("tenantId", "assignedTo");

-- CreateIndex
CREATE INDEX "Task_tenantId_status_idx" ON "Task"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Task_tenantId_dueDate_idx" ON "Task"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "Task_tenantId_contactId_idx" ON "Task"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "Task_tenantId_dealId_idx" ON "Task"("tenantId", "dealId");

-- CreateIndex
CREATE INDEX "TaskTemplate_tenantId_idx" ON "TaskTemplate"("tenantId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
