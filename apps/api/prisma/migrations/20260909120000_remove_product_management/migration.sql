-- Product catalogues and deal line items are outside the B2C lead-qualification
-- scope. Export any required historical line-item data before applying this
-- irreversible migration.

-- Saved sales reports may have persisted the retired filter/grouping. Preserve
-- the report itself while making its configuration valid for the new contract.
UPDATE "Report"
SET "config" = jsonb_set("config" - 'productId', '{groupBy}', '"MONTH"'::jsonb)
WHERE jsonb_typeof("config") = 'object'
  AND "config"->>'groupBy' = 'PRODUCT';

UPDATE "Report"
SET "config" = "config" - 'productId'
WHERE jsonb_typeof("config") = 'object'
  AND "config" ? 'productId';

-- RolePermission cascades from Permission. AuditLog stores the entity as text,
-- so historical audit entries remain intact.
DELETE FROM "Permission" WHERE "resource" = 'PRODUCT';

DROP TABLE "DealLineItem";
DROP TABLE "Product";
