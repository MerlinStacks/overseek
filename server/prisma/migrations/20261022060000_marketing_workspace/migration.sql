ALTER TABLE "MarketingAutomation"
  ADD COLUMN "draftDefinition" JSONB,
  ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "MarketingCampaign" ADD COLUMN "subjectB" TEXT;
ALTER TABLE "MarketingCampaign" ADD COLUMN "scheduleTimezone" TEXT;
ALTER TABLE "EmailLog" ADD COLUMN "campaignVariant" TEXT;
CREATE INDEX "EmailLog_accountId_source_sourceId_campaignVariant_idx" ON "EmailLog"("accountId", "source", "sourceId", "campaignVariant");
