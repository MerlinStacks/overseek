import type { DeliveryReadiness, Receipt } from './launchApi';

/** Test-only server-shaped diagnostics; production UI never synthesizes readiness. */
export const readinessFixture = (overrides: Partial<DeliveryReadiness> = {}): DeliveryReadiness => ({
    ready: false, mode: 'LEGACY', active: false, desiredActive: false, cutoverState: 'legacy', receivingFrozen: false,
    revalidationRequested: false, actions: { legacyReview: null, revalidateActivation: null },
    epoch: null, revision: '0', acknowledgedRevision: '0',
    work: { action: null, attempts: 0, lastError: null, nextAttemptAt: null },
    blockers: ['cutover_required'], warnings: [], unresolvedReceipts: 0, unresolvedLegacyJobs: 0,
    pendingInputs: 0, configuredCount: 1, freshness: { stale: 0, unverified: 0 },
    providerSupport: { supportedMethodIds: ['flat_rate'], configuredSupported: 1 },
    sync: { capability: 'supported', inboundCapability: 'supported', resyncRequested: false, inboundRequested: false, lastError: null },
    freshnessPrerequisite: { ready: true, version: 'test-prerequisite', missing: [], diagnostic: null },
    inventoryCompatibility: { ready: true, blockedCount: 0, targets: [] },
    plugin: { schemaVersion: 1, protocolVersion: 1, wooVersion: '10.0.0', blockers: [], environmentFingerprint: 'a'.repeat(64), presentation: 'classic',
        state: { revision: 0, mode: 'legacy', epoch: null, active: false } }, ...overrides,
});
export const receiptFixture = (overrides: Partial<Receipt> = {}): Receipt => ({ operationId: 'receipt-a', accountId: 'account-a',
    purchaseOrderId: 'po-a', productId: 'product-a', stockOwnerWooId: 42, sequence: '1', delta: 3,
    sourceType: 'purchase_order', sourceId: null, cycleId: 'cycle-a', cascadeState: 'waiting_receipt', cascadeAttempts: 0,
    state: 'uncertain', attempts: 1, lastError: null, ...overrides });
