-- Story 4.6: Task Dependencies & Recurring Tasks (AC 7-8)
--
-- Migration: 20260808120000_add_task_dependency_and_recurrence
-- Branch: feature/tasks/4-6-task-dependencies-recurring-tasks
--
-- Arbitrations documented:
--   AC 1: tenantId added to TaskDependency (the epic's field list omits it;
--          without tenantId there is no tenant isolation).
--   AC 1: Hard delete, NO deletedAt, NO updatedAt/updatedBy on TaskDependency.
--          This is the same exemption as TaskCalendarEvent and Activity — a
--          derived link row that is created and hard-deleted, never updated.
--          That is what makes the @@unique below safe: the DealStage soft-delete
--          + @@unique trap only bites a soft-deleting model.
--   AC 3: CUSTOM recurrence pattern deferred — no field carries the custom
--          rule, no rrule library is installed, no UX for a custom-rule editor.
--   AC 1 index rationale: the @@unique is a btree on
--          (tenantId, taskId, dependsOnTaskId), so the forward lookup
--          "what blocks task X" uses it as a prefix scan — no redundant
--          @@index([tenantId, taskId]) is needed. The extra
--          @@index([tenantId, dependsOnTaskId]) serves the reverse lookup
--          "what does task X block". @@index([tenantId]) is the house rule.
--   AC 6 onDelete choices:
--     - Task.parentTaskId → SetNull: a hard-deleted template must orphan its
--       occurrences, not delete a user's completed history.
--     - TaskDependency.taskId/dependsOnTaskId → Cascade on both: an edge
--       pointing at a hard-deleted task is garbage. PostgreSQL permits multiple
--       cascade paths into one table (unlike SQL Server).
-- Note: Tasks are soft-deleted in application code, so these Cascade/SetNull
--       fires only via Tenant/User cascade. Soft-delete is handled in AC 20.

-- 1. CreateEnum
CREATE TYPE "RecurrencePattern" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- 2. AlterTable — Task: add 4 nullable/defaulted columns
ALTER TABLE "Task" ADD COLUMN "isRecurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "recurrencePattern" "RecurrencePattern";
ALTER TABLE "Task" ADD COLUMN "recurrenceEndDate" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT;

-- 3. CreateTable — TaskDependency
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- 4. CreateIndex — TaskDependency
CREATE UNIQUE INDEX "TaskDependency_tenantId_taskId_dependsOnTaskId_key" ON "TaskDependency"("tenantId", "taskId", "dependsOnTaskId");
CREATE INDEX "TaskDependency_tenantId_idx" ON "TaskDependency"("tenantId");
CREATE INDEX "TaskDependency_tenantId_dependsOnTaskId_idx" ON "TaskDependency"("tenantId", "dependsOnTaskId");

-- 5. CreateIndex — Task (new indexes for recurrence)
CREATE INDEX "Task_tenantId_parentTaskId_idx" ON "Task"("tenantId", "parentTaskId");
CREATE INDEX "Task_tenantId_isRecurring_idx" ON "Task"("tenantId", "isRecurring");

-- 6. AddForeignKey — TaskDependency
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. AddForeignKey — Task.selfRelation (parentTaskId)
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
