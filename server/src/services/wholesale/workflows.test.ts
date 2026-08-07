import { describe, expect, it, vi } from 'vitest';
import { copiedCatalogDefaults, reconcilePlacementSelection } from './catalogs';
import { automaticSuspensionChange } from './eligibility';
import { generationArtifactRemovalDate, shareArtifactRemovalDate, shareEvidenceAnonymizationDate } from './retention';
import { isDefaultsApprovable, legalDefaultsChanged } from './settings';
import { hasWholesaleAccountMembership, isWholesaleDefaultsApprover } from './authorization';

describe('wholesale management authorization', () => {
    it('permits defaults approval only for account owners and admins', () => {
        expect(isWholesaleDefaultsApprover('OWNER')).toBe(true);
        expect(isWholesaleDefaultsApprover('ADMIN')).toBe(true);
        expect(isWholesaleDefaultsApprover('MEMBER')).toBe(false);
        expect(isDefaultsApprovable({
            termsDocument: { sections: [{ heading: 'Orders', content: 'Binding terms' }] },
            confidentialityNotice: 'Confidential', privacyNotice: 'Privacy notice',
        })).toBe(true);
        const legal = { termsDocument: { sections: [{ heading: 'Orders', content: 'Binding terms' }] }, confidentialityNotice: 'Confidential', privacyNotice: 'Privacy notice' };
        expect(legalDefaultsChanged({ ...legal, termsHash: 'wrong' }, legal)).toBe(true);
    });

    it('rejects direct super-admin account context without a real membership', async () => {
        const lookup = vi.fn().mockResolvedValue(null);
        expect(await hasWholesaleAccountMembership('super-admin', 'account-1', lookup)).toBe(false);
        expect(lookup).toHaveBeenCalledWith('super-admin', 'account-1');
    });
});

describe('catalog defaults and placement reconciliation', () => {
    it('copies only approved terms and supplies immutable payment/footer defaults', () => {
        const copied = copiedCatalogDefaults({
            approvedAt: new Date(), approvedById: 'owner', version: 'v3',
            termsDocument: { sections: [{ heading: 'Orders', content: 'Terms' }] },
            confidentialityNotice: 'Confidential', privacyNotice: 'Privacy',
        }, { termsSections: [], paymentCallout: {}, footerDetails: {} });
        expect(copied).toMatchObject({ termsSections: [{ heading: 'Orders' }], defaultsVersion: 'v3' });
        expect(copied.paymentCallout).not.toEqual({});
        expect(copied.footerDetails).toEqual({ confidentialityNotice: 'Confidential', privacyNotice: 'Privacy' });
    });

    it('deletes omitted active rows but preserves omitted suspended rows', () => {
        expect(reconcilePlacementSelection([
            { productId: 'active', isSuspended: false },
            { productId: 'hidden', isSuspended: true },
        ], [])).toEqual({ deleteProductIds: ['active'], preservedSuspendedIds: ['hidden'] });
    });

    it('automatically suspends and restores only eligibility reasons', () => {
        expect(automaticSuspensionChange({ isSuspended: false }, { inStock: false, hasPriceTiers: true })).toMatchObject({ suspensionReason: 'OUT_OF_STOCK' });
        expect(automaticSuspensionChange({ isSuspended: true, suspensionReason: 'NO_PRICE_TIERS', restoreAllowed: true }, { inStock: true, hasPriceTiers: true })).toEqual({ isSuspended: false, suspensionReason: null });
    });
});

describe('wholesale retention policy', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    it('uses 7-day, 90-day and 12-month policy dates', () => {
        expect(generationArtifactRemovalDate({ status: 'FAILED', createdAt }, [])?.toISOString()).toBe('2026-01-08T00:00:00.000Z');
        expect(generationArtifactRemovalDate({ status: 'APPROVED', approvedAt: createdAt }, [])?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
        const share = { expiresAt: new Date('2026-02-01T00:00:00.000Z'), revokedAt: new Date('2026-02-03T00:00:00.000Z') };
        expect(shareArtifactRemovalDate(share)?.toISOString()).toBe('2026-05-04T00:00:00.000Z');
        expect(shareEvidenceAnonymizationDate(share).toISOString()).toBe('2027-02-01T00:00:00.000Z');
    });
});
