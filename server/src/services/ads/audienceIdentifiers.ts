import { createHash } from 'crypto';
import { normalizePhoneE164 } from '../tracking/conversionUtils';
import type { AdvertisingProfile } from '../SegmentService';

/** Only irreversible hashes and platform-required country/postal codes are persisted. */
export interface AudienceIdentifier {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    country?: string;
    postalCode?: string;
}
const hash = (value: string) => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

/** JSONB may reorder object keys; comparison must not depend on insertion order. */
export const audienceIdentifierKey = (row: AudienceIdentifier): string =>
    [row.email, row.phone, row.firstName, row.lastName, row.country, row.postalCode].map(value => value || '').join('|');

export function audienceIdentifiers(profiles: AdvertisingProfile[], platform: string, enhanced: boolean): AudienceIdentifier[] {
    const records = profiles.map(profile => {
        const row: AudienceIdentifier = {};
        let email = profile.email?.trim().toLowerCase();
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if (platform === 'GOOGLE') {
                const [local, domain] = email.split('@');
                if (domain === 'gmail.com' || domain === 'googlemail.com') email = `${local.replace(/\./g, '')}@${domain}`;
            }
            row.email = hash(email);
        }
        if (enhanced) {
            const raw = (profile.rawData || {}) as Record<string, any>;
            const billing = raw.billing || raw;
            const country = typeof billing.country === 'string' ? billing.country.trim().toUpperCase() : '';
            const phone = normalizePhoneE164(typeof billing.phone === 'string' ? billing.phone : undefined, country);
            if (phone && /^\+[1-9]\d{7,14}$/.test(phone)) row.phone = hash(platform === 'META' ? phone.replace(/\D/g, '') : phone);
            const first = profile.firstName || billing.first_name;
            const last = profile.lastName || billing.last_name;
            // Google requires a complete name/country/postcode address identifier.
            const postcode = typeof billing.postcode === 'string' ? billing.postcode.trim().toLowerCase() : '';
            if (typeof first === 'string' && first.trim() && typeof last === 'string' && last.trim() && /^[A-Z]{2}$/.test(country) && postcode) {
                row.firstName = hash(first);
                row.lastName = hash(last);
                row.country = country;
                row.postalCode = postcode;
            }
        }
        return row;
    }).filter(row => row.email || row.phone || row.firstName);
    return [...new Map(records.map(row => [audienceIdentifierKey(row), row])).values()];
}

export const META_AUDIENCE_SCHEMA = ['EMAIL', 'PHONE', 'FN', 'LN', 'COUNTRY', 'ZIP'];
export function metaAudienceRows(rows: AudienceIdentifier[]): string[][] {
    return rows.map(row => [row.email || '', row.phone || '', row.firstName || '', row.lastName || '',
        row.country ? hash(row.country) : '', row.postalCode ? hash(row.postalCode) : '']);
}

export function googleAudienceIdentifiers(row: AudienceIdentifier): Record<string, unknown>[] {
    return [
        ...(row.email ? [{ hashedEmail: row.email }] : []),
        ...(row.phone ? [{ hashedPhoneNumber: row.phone }] : []),
        ...(row.firstName ? [{ addressInfo: { hashedFirstName: row.firstName, hashedLastName: row.lastName, countryCode: row.country, postalCode: row.postalCode } }] : []),
    ];
}
