CREATE TABLE "OauthConnectionState" (
 "tokenHash" TEXT PRIMARY KEY, "browserHash" TEXT NOT NULL, "provider" TEXT NOT NULL,
 "userId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "redirectPath" TEXT NOT NULL,
 "callbackUrl" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OauthConnectionState_expiresAt_idx" ON "OauthConnectionState"("expiresAt");
CREATE TABLE "OrderTagIndexOutbox" (
 "orderId" TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
 "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3), "leaseOwner" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "OrderTagIndexOutbox_nextAttemptAt_idx" ON "OrderTagIndexOutbox"("nextAttemptAt");
