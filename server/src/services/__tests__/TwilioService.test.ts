import { describe, expect, it } from 'vitest';
import { TwilioService } from '../TwilioService';

describe('TwilioService.normalizeToE164', () => {
    it('normalizes an Australian local mobile using the configured sender country', () => {
        expect(TwilioService.normalizeToE164('0491764367', '+61412345678'))
            .toBe('+61491764367');
    });

    it('preserves an existing international number', () => {
        expect(TwilioService.normalizeToE164('+61 491 764 367', '+61412345678'))
            .toBe('+61491764367');
    });

    it('continues to normalize North American local numbers', () => {
        expect(TwilioService.normalizeToE164('(415) 555-2671', '+14155551234'))
            .toBe('+14155552671');
    });

    it('normalizes a number with an international dialling prefix', () => {
        expect(TwilioService.normalizeToE164('0061 491 764 367', '+14155551234'))
            .toBe('+61491764367');
    });
});
