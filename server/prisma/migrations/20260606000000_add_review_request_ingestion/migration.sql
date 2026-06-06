-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderId" TEXT,
    "rating" INTEGER,
    "emailLogId" TEXT,
    "emailMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewIngestion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reviewRequestId" TEXT,
    "incomingMessageId" TEXT NOT NULL,
    "emailLogId" TEXT,
    "wooReviewId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "errorMessage" TEXT,
    "rawData" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewIngestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_token_key" ON "ReviewRequest"("token");

-- CreateIndex
CREATE INDEX "ReviewRequest_accountId_email_idx" ON "ReviewRequest"("accountId", "email");

-- CreateIndex
CREATE INDEX "ReviewRequest_accountId_productId_idx" ON "ReviewRequest"("accountId", "productId");

-- CreateIndex
CREATE INDEX "ReviewRequest_accountId_status_idx" ON "ReviewRequest"("accountId", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_accountId_emailMessageId_idx" ON "ReviewRequest"("accountId", "emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewIngestion_accountId_incomingMessageId_key" ON "ReviewIngestion"("accountId", "incomingMessageId");

-- CreateIndex
CREATE INDEX "ReviewIngestion_accountId_status_idx" ON "ReviewIngestion"("accountId", "status");

-- CreateIndex
CREATE INDEX "ReviewIngestion_reviewRequestId_idx" ON "ReviewIngestion"("reviewRequestId");

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewIngestion" ADD CONSTRAINT "ReviewIngestion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewIngestion" ADD CONSTRAINT "ReviewIngestion_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "ReviewRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
