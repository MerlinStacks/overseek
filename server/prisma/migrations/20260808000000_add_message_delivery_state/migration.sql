CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

ALTER TABLE "Message"
    ADD COLUMN "deliveryStatus" "MessageDeliveryStatus" NOT NULL DEFAULT 'SENT',
    ADD COLUMN "deliveryChannel" TEXT,
    ADD COLUMN "deliveryProvider" TEXT,
    ADD COLUMN "providerMessageId" TEXT,
    ADD COLUMN "deliveryError" TEXT,
    ADD COLUMN "deliveryAttemptedAt" TIMESTAMP(3),
    ADD COLUMN "deliveredAt" TIMESTAMP(3),
    ADD COLUMN "clientRequestId" TEXT;

CREATE UNIQUE INDEX "Message_conversationId_clientRequestId_key"
    ON "Message"("conversationId", "clientRequestId");
