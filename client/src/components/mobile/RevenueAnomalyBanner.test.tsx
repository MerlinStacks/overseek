import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevenueAnomalyBanner } from './RevenueAnomalyBanner';
afterEach(cleanup);
const anomaly = { isAnomaly: true, direction: 'above' as const, percentChange: 30, message: 'Revenue is above baseline' };
function Location() { return <div data-testid="location">{useLocation().pathname}</div>; }
describe('revenue anomaly banner', () => {
    it.each([null, { ...anomaly, isAnomaly: false }, { ...anomaly, direction: 'normal' as const }, { ...anomaly, percentChange: NaN }, { ...anomaly, percentChange: Infinity }, { ...anomaly, message: ' ' }])('hides absent or inconsistent anomaly data: %j', data => {
        render(<MemoryRouter><RevenueAnomalyBanner anomaly={data} /></MemoryRouter>);
        expect(screen.queryByRole('button')).toBeNull();
    });
    it.each(['above', 'below'] as const)('navigates for a valid %s alert without submitting', direction => {
        const submit = vi.fn(event => event.preventDefault());
        render(<MemoryRouter><form onSubmit={submit}><RevenueAnomalyBanner anomaly={{ ...anomaly, direction }} /></form><Location /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: /Revenue anomaly alert/ }));
        expect(screen.getByTestId('location')).toHaveTextContent('/m/analytics'); expect(submit).not.toHaveBeenCalled();
    });
});
