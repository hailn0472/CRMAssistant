-- Query-shape indexes for the B2C CRM read paths.
--
-- These are deliberately partial: all primary list queries exclude soft-deleted
-- records, so indexing deleted rows only increases write cost and index size.
-- Apply through Prisma migration deployment. For a very large production table,
-- create the same indexes CONCURRENTLY in a maintenance window, then mark this
-- migration as applied after verifying the exact definitions.

-- `contains` / ILIKE searches in Contacts cannot use a normal B-tree index.
-- pg_trgm makes the existing multi-field search predicate indexable without
-- changing its GraphQL contract.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Contact_active_tenant_createdAt_idx"
  ON "Contact" ("tenantId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Contact_active_tenant_owner_createdAt_idx"
  ON "Contact" ("tenantId", "ownerId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Contact_active_tenant_leadStatus_createdAt_idx"
  ON "Contact" ("tenantId", "leadStatus", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Contact_email_trgm_idx"
  ON "Contact" USING GIN ("email" gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Contact_firstName_trgm_idx"
  ON "Contact" USING GIN ("firstName" gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Contact_lastName_trgm_idx"
  ON "Contact" USING GIN ("lastName" gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Contact_company_trgm_idx"
  ON "Contact" USING GIN ("company" gin_trgm_ops)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Conversation_active_tenant_latest_idx"
  ON "Conversation" ("tenantId", "lastMessageAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Conversation_active_tenant_status_latest_idx"
  ON "Conversation" ("tenantId", "status", "lastMessageAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Conversation_active_tenant_assigned_latest_idx"
  ON "Conversation" ("tenantId", "assignedTo", "lastMessageAt" DESC)
  WHERE "deletedAt" IS NULL;
