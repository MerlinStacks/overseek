-- The status column was originally added with a PAUSED default, leaving existing
-- enabled automations in an inconsistent state that lifecycle scans excluded.
UPDATE "MarketingAutomation"
SET "status" = CASE
    WHEN "isActive" THEN 'ACTIVE'
    WHEN "status" = 'DRAFT' THEN 'DRAFT'
    ELSE 'PAUSED'
END
WHERE "status" IS DISTINCT FROM CASE
    WHEN "isActive" THEN 'ACTIVE'
    WHEN "status" = 'DRAFT' THEN 'DRAFT'
    ELSE 'PAUSED'
END;
