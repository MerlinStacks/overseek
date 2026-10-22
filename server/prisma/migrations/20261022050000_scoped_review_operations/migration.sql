CREATE TABLE "ScopedOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ScopedOperation_accountId_kind_createdAt_idx" ON "ScopedOperation"("accountId", "kind", "createdAt");
