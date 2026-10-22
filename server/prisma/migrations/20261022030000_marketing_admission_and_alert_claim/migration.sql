CREATE TABLE "AdCopyGenerationQuota" (
  "accountId" TEXT PRIMARY KEY, "windowStart" TIMESTAMP(3) NOT NULL,
  "units" INTEGER NOT NULL CHECK ("units" >= 0 AND "units" <= 40), "leaseOwner" TEXT, "leaseUntil" TIMESTAMP(3) NOT NULL
);
-- Existing alert deliveries are ambiguous; do not automatically replay historical notifications.
ALTER TABLE "AdAlert" ADD COLUMN "notificationStatus" TEXT NOT NULL DEFAULT 'legacy-unreviewed';
ALTER TABLE "AdAlert" ALTER COLUMN "notificationStatus" SET DEFAULT 'pending';
