import { describe, it, expect } from 'vitest';
import { hashSHA256, isConversionEvent, mapEventName, extractUserData, getSupportedPlatforms } from '../conversionUtils';

describe('conversionUtils', () => {
    describe('hashSHA256', () => {
        it('should hash email correctly after lowercase and trim', () => {
            const hash = hashSHA256('  Test@Example.COM  ');
            // SHA-256 of 'test@example.com'
            expect(hash).toBe(
                require('crypto').createHash('sha256').update('test@example.com').digest('hex')
            );
        });

        it('should return undefined for null/undefined/empty values', () => {
            expect(hashSHA256(null)).toBeUndefined();
            expect(hashSHA256(undefined)).toBeUndefined();
            expect(hashSHA256('')).toBeUndefined();
            expect(hashSHA256('   ')).toBeUndefined();
        });

        it('should produce consistent hashes for same input', () => {
            expect(hashSHA256('hello')).toBe(hashSHA256('hello'));
            expect(hashSHA256('Hello')).toBe(hashSHA256('hello'));
        });
    });

    describe('isConversionEvent', () => {
        it('should return true for conversion event types', () => {
            expect(isConversionEvent('purchase')).toBe(true);
            expect(isConversionEvent('add_to_cart')).toBe(true);
            expect(isConversionEvent('checkout_start')).toBe(true);
            expect(isConversionEvent('product_view')).toBe(true);
            expect(isConversionEvent('search')).toBe(true);
        });

        it('should return false for non-conversion event types', () => {
            expect(isConversionEvent('pageview')).toBe(false);
            expect(isConversionEvent('identify')).toBe(false);
            expect(isConversionEvent('cart_view')).toBe(false);
            expect(isConversionEvent('review')).toBe(false);
            expect(isConversionEvent('')).toBe(false);
        });
    });

    describe('mapEventName', () => {
        it('should map purchase to correct platform names', () => {
            expect(mapEventName('purchase', 'META')).toBe('Purchase');
            expect(mapEventName('purchase', 'TIKTOK')).toBe('CompletePayment');
            expect(mapEventName('purchase', 'GOOGLE')).toBe('purchase');
            expect(mapEventName('purchase', 'PINTEREST')).toBe('checkout');
            expect(mapEventName('purchase', 'GA4')).toBe('purchase');
        });

        it('should map add_to_cart correctly', () => {
            expect(mapEventName('add_to_cart', 'META')).toBe('AddToCart');
            expect(mapEventName('add_to_cart', 'TIKTOK')).toBe('AddToCart');
            expect(mapEventName('add_to_cart', 'GA4')).toBe('add_to_cart');
        });

        it('should return undefined for unsupported event types', () => {
            expect(mapEventName('pageview', 'META')).toBeUndefined();
            expect(mapEventName('purchase', 'UNKNOWN_PLATFORM')).toBeUndefined();
        });

        it('should map Google Ads events correctly', () => {
            expect(mapEventName('add_to_cart', 'GOOGLE')).toBe('add_to_cart');
            expect(mapEventName('checkout_start', 'GOOGLE')).toBe('begin_checkout');
            expect(mapEventName('product_view', 'GOOGLE')).toBe('view_item');
            // Google doesn't support search as a conversion action
            expect(mapEventName('search', 'GOOGLE')).toBeUndefined();
        });
    });

    describe('extractUserData', () => {
        it('should merge payload and session data (payload takes precedence)', () => {
            const payload = { email: 'payload@test.com', billingPhone: '+1234567890' };
            const session = { email: 'session@test.com', ipAddress: '1.2.3.4', userAgent: 'Mozilla/5.0', country: 'US' };

            const result = extractUserData(payload, session);

            expect(result.email).toBe('payload@test.com'); // Payload wins
            expect(result.phone).toBe('+1234567890');
            expect(result.ipAddress).toBe('1.2.3.4');
            expect(result.userAgent).toBe('Mozilla/5.0');
            expect(result.country).toBe('US');
        });

        it('should fall back to session data when payload is empty', () => {
            const result = extractUserData({}, { email: 'session@test.com', ipAddress: '1.2.3.4', userAgent: null, country: null });

            expect(result.email).toBe('session@test.com');
            expect(result.ipAddress).toBe('1.2.3.4');
        });

        it('should handle null session and undefined payload', () => {
            const result = extractUserData(undefined, null);

            expect(result.email).toBeUndefined();
            expect(result.ipAddress).toBeUndefined();
        });

        it('should extract platform cookies', () => {
            const payload = { fbc: 'fb.1.123', fbp: 'fb.1.456', ttp: 'tt-id', epq: 'pin-id', gaClientId: 'GA1.1.789.012' };
            const result = extractUserData(payload, null);

            expect(result.fbc).toBe('fb.1.123');
            expect(result.fbp).toBe('fb.1.456');
            expect(result.ttp).toBe('tt-id');
            expect(result.epq).toBe('pin-id');
            expect(result.gaClientId).toBe('GA1.1.789.012');
        });

        it('should extract billing PII from purchase payload', () => {
            const payload = {
                billingFirst: 'John',
                billingLast: 'Doe',
                billingCity: 'Sydney',
                billingState: 'NSW',
                billingZip: '2000',
                billingCountry: 'AU',
            };
            const result = extractUserData(payload, null);

            expect(result.firstName).toBe('John');
            expect(result.lastName).toBe('Doe');
            expect(result.city).toBe('Sydney');
            expect(result.state).toBe('NSW');
            expect(result.zip).toBe('2000');
            expect(result.country).toBe('AU');
        });
    });

    describe('getSupportedPlatforms', () => {
        it('should return all 8 platforms', () => {
            const platforms = getSupportedPlatforms();
            expect(platforms).toHaveLength(8);
            expect(platforms).toContain('META');
            expect(platforms).toContain('TIKTOK');
            expect(platforms).toContain('GOOGLE');
            expect(platforms).toContain('PINTEREST');
            expect(platforms).toContain('GA4');
            expect(platforms).toContain('SNAPCHAT');
            expect(platforms).toContain('MICROSOFT');
            expect(platforms).toContain('TWITTER');
        });
    });
});
