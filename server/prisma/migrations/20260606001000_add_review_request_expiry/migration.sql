-- AlterTable
ALTER TABLE "ReviewRequest" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReviewRequest_accountId_expiresAt_idx" ON "ReviewRequest"("accountId", "expiresAt");
