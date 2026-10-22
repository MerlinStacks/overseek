ALTER TABLE "ShippingLabel"
ADD COLUMN "latestTrackingOccurredAt" TIMESTAMP(3),
ADD COLUMN "trackingNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "trackingLastOutcome" TEXT;
