CREATE TYPE "WholesalePersonalisationType" AS ENUM ('ENGRAVE', 'SUBLIMATE', 'UV', 'DTF', 'EMBROIDERY');
CREATE TYPE "WholesaleTaxBasis" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');
CREATE TYPE "WholesaleCatalogStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "WholesaleCatalogSuspensionReason" AS ENUM ('OUT_OF_STOCK', 'NO_PRICE_TIERS');
CREATE TYPE "WholesaleCatalogGenerationStatus" AS ENUM ('QUEUED', 'RENDERING', 'AWAITING_APPROVAL', 'APPROVED', 'FAILED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "WholesaleCatalogValidityArtifactStatus" AS ENUM ('CURRENT', 'UPDATING', 'FAILED');
CREATE TYPE "WholesaleCatalogShareArtifactStatus" AS ENUM ('QUEUED', 'RENDERING', 'READY', 'FAILED', 'EXPIRED');

CREATE TABLE "WholesaleCatalogDefaults" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "priceTaxBasis" "WholesaleTaxBasis" NOT NULL,
    "gstRate" DECIMAL(7,4) NOT NULL,
    "termsDocument" JSONB NOT NULL,
    "confidentialityNotice" TEXT NOT NULL,
    "privacyNotice" TEXT NOT NULL,
    "setupChecklist" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "termsHash" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCatalogDefaults_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleBrandProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "headingFont" TEXT,
    "bodyFont" TEXT,
    "businessDetails" JSONB NOT NULL,
    "importSources" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleBrandProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleProductProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "notesDocument" JSONB,
    "personalisationTypes" "WholesalePersonalisationType"[] NOT NULL,
    "imageUrl" TEXT,
    "priceTaxBasis" "WholesaleTaxBasis" NOT NULL,
    "priceSetVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleProductProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesalePriceTier" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "minimumQuantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,4),
    "isPoa" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesalePriceTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicTitle" TEXT NOT NULL,
    "subtitle" TEXT,
    "coverText" TEXT,
    "pricesIncludeTax" BOOLEAN NOT NULL,
    "supplementaryPriceNotice" TEXT,
    "brandingOverrides" JSONB NOT NULL,
    "paymentCallout" JSONB NOT NULL,
    "termsSections" JSONB NOT NULL,
    "footerDetails" JSONB NOT NULL,
    "defaultsVersion" TEXT NOT NULL,
    "status" "WholesaleCatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalogProduct" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "categoryKey" TEXT,
    "categoryLabel" TEXT,
    "categorySortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "suspensionReason" "WholesaleCatalogSuspensionReason",
    "suspendedAt" TIMESTAMP(3),
    "restoreAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalogRevision" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WholesaleCatalogRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalogGeneration" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "retryOfId" TEXT,
    "status" "WholesaleCatalogGenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "versionNumber" INTEGER,
    "progressStage" TEXT,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "cancelRequestedAt" TIMESTAMP(3),
    "masterFilePath" TEXT,
    "basePagesPath" TEXT,
    "fileSize" INTEGER,
    "pageCount" INTEGER,
    "productCount" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "originalGeneratedAt" TIMESTAMP(3),
    "validityArtifactStatus" "WholesaleCatalogValidityArtifactStatus" NOT NULL DEFAULT 'CURRENT',
    "validityRevision" INTEGER NOT NULL DEFAULT 1,
    "staleAt" TIMESTAMP(3),
    "staleReasons" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCatalogGeneration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalogShare" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "customerId" TEXT,
    "createdById" TEXT NOT NULL,
    "customerSnapshot" JSONB NOT NULL,
    "tokenHash" TEXT,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "artifactStatus" "WholesaleCatalogShareArtifactStatus" NOT NULL DEFAULT 'QUEUED',
    "artifactError" TEXT,
    "personalizedPdfPath" TEXT,
    "personalizedPagesPath" TEXT,
    "personalizedFileName" TEXT,
    "confidentialityTextSnapshot" TEXT NOT NULL,
    "confidentialityHash" TEXT NOT NULL,
    "privacyNoticeSnapshot" TEXT NOT NULL,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCatalogShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalogViewer" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstAccessedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "confidentialityAcceptedAt" TIMESTAMP(3),
    "acceptedConfidentialityText" TEXT,
    "acceptedConfidentialityHash" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCatalogViewer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalogViewerSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "viewerId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceSummary" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleCatalogViewerSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleCatalogAccessLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "viewerId" TEXT,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "pageNumber" INTEGER,
    "isScanner" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WholesaleCatalogAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WholesaleCatalogDefaults_accountId_key" ON "WholesaleCatalogDefaults"("accountId");
CREATE UNIQUE INDEX "WholesaleBrandProfile_accountId_key" ON "WholesaleBrandProfile"("accountId");
CREATE UNIQUE INDEX "WholesaleProductProfile_productId_key" ON "WholesaleProductProfile"("productId");
CREATE INDEX "WholesaleProductProfile_accountId_productId_idx" ON "WholesaleProductProfile"("accountId", "productId");
CREATE UNIQUE INDEX "WholesalePriceTier_profileId_minimumQuantity_key" ON "WholesalePriceTier"("profileId", "minimumQuantity");
CREATE INDEX "WholesalePriceTier_accountId_profileId_idx" ON "WholesalePriceTier"("accountId", "profileId");
CREATE INDEX "WholesaleCatalog_accountId_status_idx" ON "WholesaleCatalog"("accountId", "status");
CREATE INDEX "WholesaleCatalog_accountId_updatedAt_idx" ON "WholesaleCatalog"("accountId", "updatedAt");
CREATE UNIQUE INDEX "WholesaleCatalogProduct_catalogId_productId_key" ON "WholesaleCatalogProduct"("catalogId", "productId");
CREATE INDEX "WholesaleCatalogProduct_accountId_catalogId_idx" ON "WholesaleCatalogProduct"("accountId", "catalogId");
CREATE INDEX "WholesaleCatalogProduct_accountId_catalogId_categorySortOrd_idx" ON "WholesaleCatalogProduct"("accountId", "catalogId", "categorySortOrder");
CREATE UNIQUE INDEX "WholesaleCatalogRevision_catalogId_revisionNumber_key" ON "WholesaleCatalogRevision"("catalogId", "revisionNumber");
CREATE INDEX "WholesaleCatalogRevision_accountId_catalogId_createdAt_idx" ON "WholesaleCatalogRevision"("accountId", "catalogId", "createdAt");
CREATE UNIQUE INDEX "WholesaleCatalogGeneration_catalogId_versionNumber_key" ON "WholesaleCatalogGeneration"("catalogId", "versionNumber");
CREATE INDEX "WholesaleCatalogGeneration_accountId_catalogId_createdAt_idx" ON "WholesaleCatalogGeneration"("accountId", "catalogId", "createdAt");
CREATE INDEX "WholesaleCatalogGeneration_accountId_status_createdAt_idx" ON "WholesaleCatalogGeneration"("accountId", "status", "createdAt");
CREATE INDEX "WholesaleCatalogGeneration_accountId_retryOfId_idx" ON "WholesaleCatalogGeneration"("accountId", "retryOfId");
CREATE UNIQUE INDEX "WholesaleCatalogShare_tokenHash_key" ON "WholesaleCatalogShare"("tokenHash");
CREATE INDEX "WholesaleCatalogShare_accountId_catalogId_idx" ON "WholesaleCatalogShare"("accountId", "catalogId");
CREATE INDEX "WholesaleCatalogShare_accountId_generationId_idx" ON "WholesaleCatalogShare"("accountId", "generationId");
CREATE INDEX "WholesaleCatalogShare_accountId_customerId_createdAt_idx" ON "WholesaleCatalogShare"("accountId", "customerId", "createdAt");
CREATE INDEX "WholesaleCatalogShare_accountId_expiresAt_idx" ON "WholesaleCatalogShare"("accountId", "expiresAt");
CREATE UNIQUE INDEX "WholesaleCatalogViewer_shareId_email_key" ON "WholesaleCatalogViewer"("shareId", "email");
CREATE INDEX "WholesaleCatalogViewer_accountId_shareId_createdAt_idx" ON "WholesaleCatalogViewer"("accountId", "shareId", "createdAt");
CREATE UNIQUE INDEX "WholesaleCatalogViewerSession_tokenHash_key" ON "WholesaleCatalogViewerSession"("tokenHash");
CREATE INDEX "WholesaleCatalogViewerSession_accountId_shareId_expiresAt_idx" ON "WholesaleCatalogViewerSession"("accountId", "shareId", "expiresAt");
CREATE INDEX "WholesaleCatalogViewerSession_accountId_viewerId_idx" ON "WholesaleCatalogViewerSession"("accountId", "viewerId");
CREATE INDEX "WholesaleCatalogAccessLog_accountId_shareId_createdAt_idx" ON "WholesaleCatalogAccessLog"("accountId", "shareId", "createdAt");
CREATE INDEX "WholesaleCatalogAccessLog_accountId_viewerId_createdAt_idx" ON "WholesaleCatalogAccessLog"("accountId", "viewerId", "createdAt");
CREATE INDEX "WholesaleCatalogAccessLog_accountId_sessionId_createdAt_idx" ON "WholesaleCatalogAccessLog"("accountId", "sessionId", "createdAt");
CREATE INDEX "WholesaleCatalogAccessLog_accountId_eventType_createdAt_idx" ON "WholesaleCatalogAccessLog"("accountId", "eventType", "createdAt");

ALTER TABLE "WholesaleCatalogDefaults" ADD CONSTRAINT "WholesaleCatalogDefaults_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogDefaults" ADD CONSTRAINT "WholesaleCatalogDefaults_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleBrandProfile" ADD CONSTRAINT "WholesaleBrandProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleProductProfile" ADD CONSTRAINT "WholesaleProductProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleProductProfile" ADD CONSTRAINT "WholesaleProductProfile_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WooProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesalePriceTier" ADD CONSTRAINT "WholesalePriceTier_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesalePriceTier" ADD CONSTRAINT "WholesalePriceTier_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "WholesaleProductProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalog" ADD CONSTRAINT "WholesaleCatalog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogProduct" ADD CONSTRAINT "WholesaleCatalogProduct_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogProduct" ADD CONSTRAINT "WholesaleCatalogProduct_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "WholesaleCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogProduct" ADD CONSTRAINT "WholesaleCatalogProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WooProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogRevision" ADD CONSTRAINT "WholesaleCatalogRevision_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogRevision" ADD CONSTRAINT "WholesaleCatalogRevision_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "WholesaleCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogRevision" ADD CONSTRAINT "WholesaleCatalogRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogGeneration" ADD CONSTRAINT "WholesaleCatalogGeneration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogGeneration" ADD CONSTRAINT "WholesaleCatalogGeneration_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "WholesaleCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogGeneration" ADD CONSTRAINT "WholesaleCatalogGeneration_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogGeneration" ADD CONSTRAINT "WholesaleCatalogGeneration_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogGeneration" ADD CONSTRAINT "WholesaleCatalogGeneration_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "WholesaleCatalogGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogShare" ADD CONSTRAINT "WholesaleCatalogShare_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogShare" ADD CONSTRAINT "WholesaleCatalogShare_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "WholesaleCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogShare" ADD CONSTRAINT "WholesaleCatalogShare_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "WholesaleCatalogGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogShare" ADD CONSTRAINT "WholesaleCatalogShare_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WooCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogShare" ADD CONSTRAINT "WholesaleCatalogShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogViewer" ADD CONSTRAINT "WholesaleCatalogViewer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogViewer" ADD CONSTRAINT "WholesaleCatalogViewer_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "WholesaleCatalogShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogViewerSession" ADD CONSTRAINT "WholesaleCatalogViewerSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogViewerSession" ADD CONSTRAINT "WholesaleCatalogViewerSession_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "WholesaleCatalogShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogViewerSession" ADD CONSTRAINT "WholesaleCatalogViewerSession_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "WholesaleCatalogViewer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogAccessLog" ADD CONSTRAINT "WholesaleCatalogAccessLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogAccessLog" ADD CONSTRAINT "WholesaleCatalogAccessLog_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "WholesaleCatalogShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogAccessLog" ADD CONSTRAINT "WholesaleCatalogAccessLog_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "WholesaleCatalogViewer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleCatalogAccessLog" ADD CONSTRAINT "WholesaleCatalogAccessLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WholesaleCatalogViewerSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
