ALTER TABLE "EmailUnsubscribe" ADD COLUMN "contactStatus" TEXT;

-- Exact machine-generated reasons only. Scope controls sending permissions, not
-- contact classification; free-form text (even containing "complaint") is unknown.
UPDATE "EmailUnsubscribe"
SET "contactStatus" = CASE
    WHEN "reason" IN ('Marked as complaint in customer profile', 'Marked as spam complaint') THEN 'COMPLAINT'
    WHEN "reason" IN ('Marked as hard bounce in customer profile', 'Marked as email bounce') THEN 'BOUNCED'
    WHEN "reason" = 'Marked as soft bounced in customer profile' THEN 'SOFT_BOUNCED'
    WHEN "reason" = 'Marked as unverified in customer profile' THEN 'UNVERIFIED'
    WHEN "reason" IN (
        'Marked as unsubscribed in customer profile',
        'Automation unsubscribe action',
        'New customer default',
        'Auto-unsubscribed: inbound inbox sender without prior customer profile',
        'Bulk unsubscribe upload',
        'Preference center update'
    ) THEN 'UNSUBSCRIBED'
    ELSE NULL
END;

-- Webhooks can supply arbitrary reasons and need not have a WooCustomer row.
-- Require the same tenant, normalized recipient and exact persisted reason,
-- plus agreement between the final log status and a delivery tracking event.
-- Conflicting evidence stays unknown rather than guessing complaint precedence.
WITH delivery_evidence AS (
    SELECT suppression."id",
           MIN(CASE log."status" WHEN 'COMPLAINED' THEN 'COMPLAINT' ELSE 'BOUNCED' END) AS "contactStatus"
    FROM "EmailUnsubscribe" suppression
    JOIN "EmailLog" log
      ON log."accountId" = suppression."accountId"
     AND LOWER(TRIM(log."to")) = LOWER(TRIM(suppression."email"))
     AND log."errorMessage" = suppression."reason"
    WHERE suppression."contactStatus" IS NULL
      AND suppression."scope" = 'ALL'
      AND NULLIF(TRIM(suppression."reason"), '') IS NOT NULL
      AND log."status" IN ('COMPLAINED', 'BOUNCED')
      AND EXISTS (
          SELECT 1 FROM "MessageTrackingEvent" event
          WHERE event."emailLogId" = log."id"
            AND event."eventType" = CASE log."status" WHEN 'COMPLAINED' THEN 'COMPLAINT' ELSE 'BOUNCE' END
      )
    GROUP BY suppression."id"
    HAVING COUNT(DISTINCT log."status") = 1
)
UPDATE "EmailUnsubscribe" suppression
SET "contactStatus" = evidence."contactStatus"
FROM delivery_evidence evidence
WHERE suppression."id" = evidence."id";
