# OverSeek Edge Cases - TODO List

> Generated: 2026-02-06  
> Status: Active  
> Priority Key: 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low

---

## 🔴 Critical Priority (Data Integrity / Security)

### BOM Consumption Safety
- [x] **Add PostgreSQL advisory lock fallback for BOM consumption** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/BOMConsumptionService.ts`
  - Issue: If Redis fails, lock not acquired → potential double-deduction
  - Fix: Added dual-lock strategy with pg_try_advisory_lock fallback
  
- [ ] **Implement BOM deduction rollback on process crash**
  - File: `server/src/services/BOMConsumptionService.ts`
  - Issue: Partial deduction leaves inventory inconsistent
  - Fix: Wrap in transaction, log pending deductions, add recovery job

### Authentication & Security
- [ ] **Implement JWT refresh token mechanism**
  - Files: `server/src/routes/auth.ts`, `client/src/context/AuthContext.tsx`
  - Issue: 7-day token expiry forces abrupt logout
  - Fix: Add `/api/auth/refresh` endpoint, silent refresh before expiry

- [x] **Reject webhooks when secret is empty/missing** ✅ *Already implemented*
  - File: `server/src/routes/webhook.ts`
  - Issue: `verifySignature()` may accept empty secret
  - Fix: Lines 169-173 already check for empty secret and return 401

- [x] **Add encryption key validation on startup** ✅ *Fixed 2026-02-06*
  - File: `server/src/utils/env.ts`
  - Issue: Changed `ENCRYPTION_KEY` breaks all encrypted credentials
  - Fix: Added fingerprint logging + dev key detection in production

### Rate Limiting
- [x] **Fix memory leak in fallback rate limiting** ✅ *Fixed 2026-02-06*
  - File: `server/src/routes/auth.ts`
  - Issue: In-memory `loginAttempts` Map grows unbounded if Redis down
  - Fix: Added 10-minute cleanup interval + 10,000 entry cap with eviction

---

## 🟠 High Priority (Sync & Data Flow)

### Product Sync
- [x] **Handle empty price string explicitly** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/sync/ProductSync.ts`
  - Issue: Empty string → null → displays as "Free"
  - Fix: Added logging for visibility + explicit null handling with comment

- [x] **Distinguish null vs 0 stock quantity** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/sync/ProductSync.ts`
  - Issue: Null = unlimited stock, 0 = out of stock; easily confused
  - Fix: Added comment clarifying stockStatus sync from WooCommerce

### Order Sync
- [x] **Improve deadlock resilience in customer count recalculation** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/sync/OrderSync.ts`
  - Issue: 40P01 still possible after retry exhaustion
  - Fix: On exhausted retries, adds account to Redis maintenance queue for later retry

- [ ] **Link guest orders to registered accounts**
  - File: `server/src/services/sync/CustomerSync.ts`
  - Issue: Guest checkout orders don't link when customer registers later
  - Fix: Add email-based identity resolution job

### Email Ingestion
- [x] **Add Redis caching for blocked contact checks** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/BlockedContactService.ts`
  - Issue: Emails fetched before blocked check; repeated DB queries on each email
  - Fix: Added Redis set caching with O(1) membership check and cache invalidation

- [x] **Improve email threading for missing headers** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/EmailIngestion.ts`
  - Issue: No `In-Reply-To` → duplicate conversations
  - Fix: Added TIER 1.5 subject-based matching for same sender within 7 days

### Review Sync
- [x] **Improve reviewer-to-customer matching** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/sync/ReviewSync.ts`
  - Issue: Orphaned reviews when email doesn't match
  - Fix: Added `matchStatus` field to track matched/unmatched reviews with logging for manual review

---

## 🟡 Medium Priority (API & Network)

### External API Resilience
- [x] **Add retry logic for OpenRouter 429 responses** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/ai.ts`
  - Issue: AI draft/suggestions fail silently on rate limit
  - Fix: Added exponential backoff retry (3 attempts: 1s, 2s, 4s)

- [x] **Handle WooCommerce credential revocation gracefully** ✅ *Fixed 2026-02-06*
  - Files: `server/src/services/woo.ts`, `server/src/utils/retryWithBackoff.ts`
  - Issue: No auto-reconnect; user unaware until sync fails
  - Fix: Added isCredentialError check + wooNeedsReconnect flag in account

- [x] **Add webhook staleness check on replay** ✅ *Fixed 2026-02-06*
  - File: `server/src/routes/admin/webhooks.ts`
  - Issue: Replayed webhook may contain outdated data
  - Fix: Added timestamp validation (reject >24h, warn >1h) + warning in response

### Socket.io
- [x] **Prune stale presence entries on reconnect** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/CollaborationService.ts`
  - Issue: Brief "ghost" presence entries after reconnect
  - Fix: Reduced TTL to 60s + pruneStale on join (30s threshold)

---

## 🟡 Medium Priority (UI/Client)

### Data Loading
- [x] **Add user feedback when account context missing** ✅ *Fixed 2026-02-06*
  - File: `client/src/hooks/useApi.ts`
  - Issue: `!isReady` → silent API failures
  - Fix: Added `notReadyReason` field returning 'no_token' or 'no_account'

- [x] **Handle skeleton infinite loading in offline mode** ✅ *Fixed 2026-02-06*
  - Files: `client/src/hooks/useLoadingTimeout.ts`, `client/src/components/ui/LoadingTimeoutWrapper.tsx`
  - Issue: Offline PWA shows skeletons indefinitely
  - Fix: Added `useLoadingTimeout` hook and `LoadingTimeoutWrapper` component with 10s timeout

### Concurrency
- [ ] **Add conflict resolution for concurrent order edits**
  - Files: `client/src/pages/OrderDetailPage.tsx`, `server/src/routes/orders.ts`
  - Issue: No merge/conflict resolution; last write wins
  - Fix: Add optimistic locking with `updatedAt` version check

- [x] **Add leader election timeout for tab coordination** ✅ *Already implemented*
  - File: `client/src/hooks/useTabLeader.ts`
  - Issue: Leader tab crashes → all tabs wait indefinitely
  - Fix: Already has 5s timeout (LEADER_TIMEOUT) with heartbeat-based stale tab pruning

---

## 🟡 Medium Priority (Business Logic)

### Pricing & Forecasting
- [x] **Add gold price API fallback notification** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/GoldPriceService.ts`
  - Issue: Stale pricing used silently when API unavailable
  - Fix: Creates notification when using cached price >1hr old

- [x] **Handle insufficient historical data for forecasting** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/analytics/SalesForecast.ts`
  - Issue: <90 days data → inaccurate predictions
  - Fix: Added confidence score (high/medium/low), data quality warnings, and logging for low-confidence forecasts

### Automation
- [x] **Prevent abandoned cart email for completed orders** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/tracking/AbandonedCartService.ts`
  - Issue: 15-min interval may send email after checkout
  - Fix: Added order completion check before enrollment (1hr lookback)

- [x] **Handle missing business hours configuration** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/EmailIngestion.ts`
  - Issue: No auto-reply if business hours not set
  - Fix: Added default business hours (Mon-Fri 9am-5pm) when not configured

### AI Co-Pilot
- [x] **Add fallback when no store policies configured** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/InboxAIService.ts`
  - Issue: Generic AI responses without store context
  - Fix: Added warning log + warning in response pointing users to add policies

- [x] **Handle empty customer segments gracefully** ✅ *Fixed 2026-02-06*
  - File: `server/src/services/SegmentService.ts`
  - Issue: Empty CSV export attempted
  - Fix: Throws descriptive error with segment name and guidance

---

## 🔵 Low Priority (Platform-Specific)

### OAuth & Tokens
- [ ] **Add proactive Meta token refresh**
  - File: `server/src/routes/oauthMeta.ts`
  - Issue: Token refresh failure breaks DM sync
  - Fix: Refresh 7 days before expiry; notify on repeated failure

- [ ] **Validate TikTok webhook signature algorithm**
  - File: `server/src/routes/tiktok-webhook.ts`
  - Issue: Different signature algo than WooCommerce
  - Fix: Add explicit algorithm documentation; add test coverage

### WooCommerce Plugin
- [ ] **Improve bot detection patterns**
  - File: `overseek-wc-plugin/includes/class-overseek-server-tracking.php`
  - Issue: New bots slip through; inflate analytics
  - Fix: Add monthly bot pattern update from community list

- [ ] **Handle caching plugin conflicts**
  - File: `overseek-wc-plugin/includes/class-overseek-server-tracking.php`
  - Issue: Cached pages may miss visitor ID cookie
  - Fix: Add documentation; recommend cache exclusion rules

---

## 🔵 Low Priority (Infrastructure)

### Docker & Containers
- [x] **Add Elasticsearch cold start grace period** ✅ *Already implemented*
  - File: `docker-compose.yml`
  - Issue: False "unhealthy" on initial deploy
  - Fix: Already has `start_period: 60s` configured on healthcheck

- [ ] **Add Redis reconnection handling for BullMQ**
  - File: `server/src/services/queue/QueueService.ts`
  - Issue: Queue jobs pile up; OOM on reconnect
  - Fix: Add max queue depth; drop oldest on overflow

### Database
- [ ] **Add connection pool monitoring**
  - File: `server/src/utils/prisma.ts`
  - Issue: Pool exhaustion causes sync timeouts
  - Fix: Add metrics endpoint; alert at 80% usage

### File Handling
- [ ] **Add upload progress/timeout handling**
  - File: `server/src/routes/uploads.ts`
  - Issue: 100MB upload may timeout on slow connections
  - Fix: Add chunked upload; resume capability

- [ ] **Validate backup stream integrity**
  - File: `server/src/services/backup/BackupService.ts`
  - Issue: Interrupted backup → corrupted file
  - Fix: Add checksum; atomic rename on completion

---

## 🔴 TODO Items from Code Comments

### Ads Module (Blocking Marketing Automation)
- [ ] **Implement individual ad-level metrics fetching**
  - File: `server/src/services/ads/CreativeVariantService.ts:223`
  - Impact: A/B test winner detection incomplete

- [ ] **Implement actual ad pausing in platform**
  - File: `server/src/services/ads/CreativeVariantService.ts:439`
  - Impact: Auto-pause underperformers doesn't work

- [ ] **Aggregate daily spend for reports**
  - File: `server/src/services/ads/ExecutiveReportService.ts:249`
  - Impact: Spend-by-day chart is empty

---

## Progress Tracking

| Category | Total | Done | % Complete |
|----------|-------|------|------------|
| 🔴 Critical | 6 | 4 | 67% |
| 🟠 High | 8 | 6 | 75% |
| 🟡 Medium (API) | 4 | 4 | 100% |
| 🟡 Medium (UI) | 4 | 3 | 75% |
| 🟡 Medium (Business) | 6 | 6 | 100% |
| 🔵 Low (Platform) | 4 | 0 | 0% |
| 🔵 Low (Infra) | 5 | 1 | 20% |
| 🔴 TODOs from Code | 3 | 0 | 0% |
| **TOTAL** | **40** | **24** | **60%** |

---

## Next Steps

1. **Sprint 1 (Week 1)**: Complete all 🔴 Critical items
2. **Sprint 2 (Week 2)**: Complete 🟠 High priority items
3. **Sprint 3 (Week 3-4)**: Address 🟡 Medium priority items
4. **Ongoing**: 🔵 Low priority items as time permits

---

*Last Updated: 2026-02-06 09:00*
