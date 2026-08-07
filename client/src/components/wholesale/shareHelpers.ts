import type { WholesaleCatalogGeneration, WholesaleCatalogShare, WholesaleShareStatus } from '../../types/wholesaleCatalog';

const DAY = 24 * 60 * 60 * 1000;

export function shareStatusLabel(status: WholesaleShareStatus) {
    return status.charAt(0) + status.slice(1).toLowerCase();
}

export function isPreparingShare(share: Pick<WholesaleCatalogShare, 'status'>) {
    return share.status === 'PREPARING';
}

export function canActivateShare(share: Pick<WholesaleCatalogShare, 'status'>) {
    return share.status === 'READY' || share.status === 'ACTIVE' || share.status === 'LOCKED';
}

export function shareableGenerations(generations: WholesaleCatalogGeneration[], catalogId: string, now = new Date()) {
    return generations.filter(generation => generation.catalogId === catalogId
        && generation.status === 'APPROVED'
        && !generation.staleAt
        && new Date(generation.validUntil) > now);
}

export function absoluteShareExpiry(createdAt: string | Date) {
    return new Date(new Date(createdAt).getTime() + 90 * DAY);
}

export function defaultShareExpiry(now = new Date()) {
    return new Date(now.getTime() + 30 * DAY);
}

export function toLocalDateTime(value: Date) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

export function isValidShareExpiry(value: string, createdAt = new Date(), now = new Date()) {
    const expiry = new Date(value);
    return !Number.isNaN(expiry.getTime()) && expiry > now && expiry <= absoluteShareExpiry(createdAt);
}
