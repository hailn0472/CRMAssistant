-- Step 1: Save existing role data to a temporary table before dropping anything
CREATE TEMP TABLE _role_migration_data AS
SELECT id AS "userId", role::text AS "oldRole", "tenantId"
FROM "User"
WHERE role IS NOT NULL;

-- Step 2: Drop old enum and column (free the "UserRole" name for the new table)
DROP TYPE IF EXISTS "UserRole" CASCADE;
ALTER TABLE "User" DROP COLUMN IF EXISTS "role";

-- Step 3: Create new tables
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT NOT NULL DEFAULT 'system',

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Step 4: Seed system roles for each tenant
DO $$
DECLARE
    tenant_record RECORD;
BEGIN
    FOR tenant_record IN SELECT id FROM "Tenant" LOOP
        INSERT INTO "Role" ("id", "tenantId", "name", "description", "isSystem", "createdAt", "updatedAt", "createdBy", "updatedBy")
        VALUES
        (gen_random_uuid()::text, tenant_record.id, 'ADMIN', 'Full system access', true, NOW(), NOW(), 'system', 'system'),
        (gen_random_uuid()::text, tenant_record.id, 'SALES_MANAGER', 'Sales team manager', true, NOW(), NOW(), 'system', 'system'),
        (gen_random_uuid()::text, tenant_record.id, 'SALES_REP', 'Sales representative', true, NOW(), NOW(), 'system', 'system'),
        (gen_random_uuid()::text, tenant_record.id, 'SUPPORT_AGENT', 'Customer support agent', true, NOW(), NOW(), 'system', 'system'),
        (gen_random_uuid()::text, tenant_record.id, 'MARKETING_USER', 'Marketing team member', true, NOW(), NOW(), 'system', 'system');
    END LOOP;
END $$;

-- Step 5: Migrate existing user role assignments using saved temp data
-- Maps old enum values: ADMIN→ADMIN, MANAGER→SALES_MANAGER, SALES_REP→SALES_REP
INSERT INTO "UserRole" ("userId", "roleId", "assignedAt", "assignedBy")
SELECT
    md."userId",
    r.id AS "roleId",
    NOW() AS "assignedAt",
    'migration' AS "assignedBy"
FROM _role_migration_data md
JOIN "Role" r ON r."tenantId" = md."tenantId"
    AND r.name = CASE md."oldRole"
        WHEN 'ADMIN' THEN 'ADMIN'
        WHEN 'MANAGER' THEN 'SALES_MANAGER'
        WHEN 'SALES_REP' THEN 'SALES_REP'
        ELSE NULL
    END
WHERE r.name IS NOT NULL;

-- Clean up temp table
DROP TABLE IF EXISTS _role_migration_data;

-- Indexes
CREATE INDEX "Role_tenantId_idx" ON "Role"("tenantId");
CREATE UNIQUE INDEX "Role_tenantId_name_key" ON "Role"("tenantId", "name");
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- Foreign Keys
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
