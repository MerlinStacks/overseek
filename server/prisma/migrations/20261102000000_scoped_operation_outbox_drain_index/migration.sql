-- Match the literal predicates in drainCriticalEvents. Completed/uncertain history
-- is excluded, so the five-second poll only reads never-attempted pending receipts.
-- CONCURRENTLY avoids blocking writes while scanning an existing large table.
-- This migration must run outside a transaction (Prisma's PostgreSQL default).
CREATE INDEX CONCURRENTLY "ScopedOperation_pending_critical_event_idx"
ON "ScopedOperation"("createdAt", "id")
WHERE "kind" = 'critical-event-outbox' AND "result"->>'state' = 'pending';
