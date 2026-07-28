ALTER TABLE "Account"
ADD COLUMN "subscribeNewCustomersByDefault" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "EmailList"
ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
