import { expect, it } from 'vitest';
import { forecastErrorMessage } from './forecastErrorMessage';

it('explains unsupported BOM planning without hiding it as a transient fetch error', () => {
    expect(forecastErrorMessage(new Error('BOM forecast unavailable: nested/cyclic component demand requires multi-level planning'))).toContain('Multi-level demand planning is not supported');
    expect(forecastErrorMessage(new Error('BOM component variation unresolved'))).toContain('Check component references');
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
