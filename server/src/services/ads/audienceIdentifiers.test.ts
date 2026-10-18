import { describe, expect, it } from 'vitest';
import { audienceIdentifiers, googleAudienceIdentifiers, metaAudienceRows } from './audienceIdentifiers';

const profile = { email: ' Person.Name@gmail.com ', firstName: 'Jane', lastName: 'Doe', rawData: { billing: { phone: '0412 345 678', country: 'AU', postcode: '2000' } } };
describe('Advertising matching identifiers', () => {
    it('does not expand existing email-only sharing', () => {
        const rows = audienceIdentifiers([profile], 'GOOGLE', false);
        expect(Object.keys(rows[0])).toEqual(['email']);
        expect(rows[0].email).toMatch(/^[a-f0-9]{64}$/);
    });
    it('normalizes phones per platform and requires complete address matching data', () => {
        const google = audienceIdentifiers([profile], 'GOOGLE', true)[0];
        const meta = audienceIdentifiers([profile], 'META', true)[0];
        expect(google.phone).toBe('bc65da54a3ddbacfdc93a0400f0a2d78e41c2180c8255015e9616facfe56f58a');
        expect(meta.phone).not.toBe(google.phone);
        expect(googleAudienceIdentifiers(google)).toHaveLength(3);
        expect(googleAudienceIdentifiers(google)[2]).toMatchObject({ addressInfo: { countryCode: 'AU', postalCode: '2000' } });
        expect(metaAudienceRows([meta])[0]).toHaveLength(6);
        expect(metaAudienceRows([meta])[0].every(value => /^[a-f0-9]{64}$/.test(value))).toBe(true);
        expect(JSON.stringify(google)).not.toContain('Jane');
    });
    it('supports phone-only profiles without inventing country codes or incomplete address identifiers', () => {
        const rows = audienceIdentifiers([{ email: '', firstName: 'Jane', rawData: { billing: { phone: '+61412345678' } } }], 'GOOGLE', true);
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0])).toEqual(['phone']);
        expect(audienceIdentifiers([{ email: '', rawData: { phone: '0412345678' } }], 'GOOGLE', true)).toEqual([]);
    });
    it('deduplicates normalized email-only profiles', () => {
        expect(audienceIdentifiers([profile, { email: 'personname@gmail.com' }], 'GOOGLE', false)).toHaveLength(1);
    });
    it('ignores malformed raw billing values instead of breaking the entire sync', () => {
        expect(audienceIdentifiers([{ email: 'person@example.com', rawData: { billing: { phone: 123, first_name: {}, last_name: [], country: 'AU', postcode: ' ' } } }], 'META', true)[0]).toEqual({ email: expect.any(String) });
    });
});
