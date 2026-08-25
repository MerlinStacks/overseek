CREATE TABLE "SyncSchedule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncSchedule_accountId_entityType_key" ON "SyncSchedule"("accountId", "entityType");
CREATE INDEX "SyncSchedule_enabled_nextRunAt_idx" ON "SyncSchedule"("enabled", "nextRunAt");

ALTER TABLE "SyncSchedule" ADD CONSTRAINT "SyncSchedule_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
