CREATE TABLE "NativeAdAudience" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definitionKey" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "consentConfirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NativeAdAudience_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NativeAdAudience_accountId_adAccountId_definitionKey_key" ON "NativeAdAudience"("accountId", "adAccountId", "definitionKey");
CREATE INDEX "NativeAdAudience_accountId_createdAt_idx" ON "NativeAdAudience"("accountId", "createdAt");
CREATE INDEX "NativeAdAudience_adAccountId_idx" ON "NativeAdAudience"("adAccountId");
ALTER TABLE "NativeAdAudience" ADD CONSTRAINT "NativeAdAudience_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NativeAdAudience" ADD CONSTRAINT "NativeAdAudience_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
