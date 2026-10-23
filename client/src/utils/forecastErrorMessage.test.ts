import { expect, it } from 'vitest';
import { forecastErrorMessage } from './forecastErrorMessage';

it('explains genuine cycles without claiming valid multi-level planning is unsupported', () => {
    expect(forecastErrorMessage(new Error('BOM forecast unavailable: cyclic component references detected'))).toContain('component cycle');
    expect(forecastErrorMessage(new Error('BOM forecast unavailable: nested/cyclic component demand requires multi-level planning'))).toContain('updated server');
    expect(forecastErrorMessage(new Error('BOM component variation unresolved'))).toContain('Check component references');
});

it('explains bounded planning failures without presenting partial demand', () => {
    expect(forecastErrorMessage(new Error('BOM forecast coverage limit exceeded'))).toContain('planning limits');
    expect(forecastErrorMessage(new Error('BOM demand overflow'))).toContain('planning limits');
});

it('distinguishes incomplete sales history from zero demand', () => {
    expect(forecastErrorMessage(new Error('Historical sales buckets incomplete'))).toContain('sales history could not be read completely');
});

it('shows HTTP context without leaking database errors', () => {
    const error = Object.assign(new Error('SQL credentials and private query'), { status: 500 });
    expect(forecastErrorMessage(error)).toContain('HTTP 500');
    expect(forecastErrorMessage(error)).not.toContain('credentials');
    expect(forecastErrorMessage(Object.assign(new Error('expired'), { status: 401 }))).toContain('sign in again');
});
