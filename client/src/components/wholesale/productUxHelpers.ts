import type { WholesaleProductHistorySnapshot } from '../../types/wholesaleCatalog';

export function isLowResolutionImage(width: number, height: number) {
    return width < 800 || height < 800;
}

function tierSummary(snapshot?: WholesaleProductHistorySnapshot | null) {
    if (!snapshot?.priceTiers?.length) return 'No tiers';
    return snapshot.priceTiers.map(tier => `${tier.minimumQuantity}+: ${tier.isPoa ? 'POA' : `$${tier.unitPrice}`}${tier.leadTimeDays == null ? '' : ` (${tier.leadTimeDays} days)`}`).join(', ');
}

export function formatHistorySnapshot(snapshot?: WholesaleProductHistorySnapshot | null) {
    return {
        tiers: tierSummary(snapshot),
        tax: snapshot?.priceTaxBasis === 'INCLUSIVE' ? 'Tax inclusive' : snapshot?.priceTaxBasis === 'EXCLUSIVE' ? 'Tax exclusive' : 'Not set',
        badges: snapshot?.personalisationTypes?.length ? snapshot.personalisationTypes.join(', ') : 'No process badges',
        turnaround: snapshot?.baseTurnaroundDays == null ? 'No base turnaround' : `Base turnaround: ${snapshot.baseTurnaroundDays} days`,
    };
}

export function areShareNotificationsEnabled(notificationsMuted?: boolean) {
    return notificationsMuted !== true;
}
