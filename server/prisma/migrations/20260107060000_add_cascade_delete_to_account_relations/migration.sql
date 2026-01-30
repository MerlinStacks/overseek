-- AlterTable: Add CASCADE delete to AccountUser
ALTER TABLE "AccountUser" DROP CONSTRAINT IF EXISTS "AccountUser_accountId_fkey";
ALTER TABLE "AccountUser" ADD CONSTRAINT "AccountUser_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountUser" DROP CONSTRAINT IF EXISTS "AccountUser_userId_fkey";
ALTER TABLE "AccountUser" ADD CONSTRAINT "AccountUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Add CASCADE delete to AccountFeature
ALTER TABLE "AccountFeature" DROP CONSTRAINT IF EXISTS "AccountFeature_accountId_fkey";
ALTER TABLE "AccountFeature" ADD CONSTRAINT "AccountFeature_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Add CASCADE delete to DashboardLayout
ALTER TABLE "DashboardLayout" DROP CONSTRAINT IF EXISTS "DashboardLayout_accountId_fkey";
ALTER TABLE "DashboardLayout" ADD CONSTRAINT "DashboardLayout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DashboardLayout" DROP CONSTRAINT IF EXISTS "DashboardLayout_userId_fkey";
ALTER TABLE "DashboardLayout" ADD CONSTRAINT "DashboardLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Add CASCADE delete to AdAccount
ALTER TABLE "AdAccount" DROP CONSTRAINT IF EXISTS "AdAccount_accountId_fkey";
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
