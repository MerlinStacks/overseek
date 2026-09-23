import { describe, expect, it } from 'vitest';
import { responseFixture } from './fixtures.test-support';
import { settingsErrors } from './validation';

describe('delivery settings cross-field validation', () => {
    it('allows independent weekend-only calendars, zero days and leap dates', () => {
        const { settings } = responseFixture();
        settings.productionWeekdays = [0]; settings.transitWeekdays = [6]; settings.fallbackSupplierLeadTimeDays = 0;
        settings.closures = [{ date: '2028-02-29', scope: 'work' }];
        settings.shippingMethods[0].minTransitDays = 0;
        expect(settingsErrors(settings)).toEqual([]);
    });
    it('rejects unusable calendars, timezone, date, reversed ranges and duplicate identities across zones', () => {
        const { settings } = responseFixture();
        settings.productionWeekdays = []; settings.timezone = 'Invalid/Zone';
        settings.closures = [{ date: '2027-02-29', scope: 'both' }];
        settings.shippingMethods[0].minTransitDays = 4;
        settings.shippingMethods.push({ ...settings.shippingMethods[0], zoneId: 10 });
        const errors = settingsErrors(settings).join(' ');
        expect(errors).toMatch(/production/); expect(errors).toMatch(/timezone/); expect(errors).toMatch(/calendar date/);
        expect(errors).toMatch(/minimum ≤ maximum/); expect(errors).toMatch(/unique/);
    });
    it('does not substitute a default after identity edits or disabling a row', () => {
        const { settings } = responseFixture();
        settings.shippingMethods[0].enabled = false;
        expect(settingsErrors(settings).join()).toMatch(/Default method is unavailable/);
        settings.shippingMethods[0].enabled = true;
        settings.shippingMethods[0].instanceId = 4;
        expect(settingsErrors(settings).join()).toMatch(/Default method is unavailable/);
        settings.defaultMethod = null;
        expect(settingsErrors(settings)).toEqual([]);
    });
});
