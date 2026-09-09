-- The B2C CRM lifecycle ends at Qualified Lead/Not a Lead. Export all Deal,
-- sales-report and deal-attachment history before applying this irreversible
-- migration. Data in the dropped tables cannot be recovered from this DB.

-- A Note now has exactly one Contact parent. Deal-only notes have no valid
-- parent in the new model and are intentionally removed with the Deal history.
DELETE FROM "Note" WHERE "dealId" IS NOT NULL;
DELETE FROM "Activity" WHERE "source" = 'DEAL';
DELETE FROM "SharingRule" WHERE "resourceType" = 'DEAL';

-- Remove dependent data and foreign-key columns before dropping Deal.
DROP TABLE "DealReminderSnooze";
DROP TABLE "DealReminder";
DROP TABLE "DealCommentMention";
DROP TABLE "DealComment";
DROP TABLE "DealDocument";
DROP TABLE "DealCompetitor";

-- Deal has an optional direct competitor reference in addition to the
-- join-table above. Remove that foreign key before retiring Competitor; Deal
-- itself is dropped later in this migration.
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_competitorId_fkey";
DROP TABLE "Competitor";
DROP TABLE "ForecastSnapshot";
DROP TABLE "CustomerAnalyticsSnapshot";
DROP TABLE "UserReminderPreference";

ALTER TABLE "Task" DROP COLUMN "dealId";
ALTER TABLE "Notification" DROP COLUMN "dealId";
ALTER TABLE "Note" DROP COLUMN "dealId";
ALTER TABLE "Note" ALTER COLUMN "contactId" SET NOT NULL;

DROP TABLE "Deal";
DROP TABLE "DealStage";

-- Retire sales-derived analytics; Contact qualification is now represented by
-- leadStatus, leadScore and qualificationReason instead.
DROP INDEX "Contact_tenantId_churnRisk_idx";
DROP INDEX "Contact_tenantId_lifetimeValue_idx";
DROP INDEX "Contact_tenantId_lastActivityDate_idx";
ALTER TABLE "Contact"
  DROP COLUMN "lifetimeValue",
  DROP COLUMN "churnRisk",
  DROP COLUMN "churnRiskScore",
  DROP COLUMN "lastActivityDate",
  DROP COLUMN "analyticsCalculatedAt";

ALTER TABLE "UserActivityLogPreference"
  DROP COLUMN "logDealCreated",
  DROP COLUMN "logDealStageChanged";

-- Retire permissions that could otherwise remain assigned to roles.
DELETE FROM "Permission" WHERE "resource" IN ('DEAL', 'COMPETITOR');
