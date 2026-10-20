import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ currency: 'EUR' }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { currency: mocks.currency } }) }));
import { VisitorsTable } from './VisitorsTable';
import { AnalyticsOverview } from './AnalyticsOverview';
import { cartAmount, cartMoney, flagEmoji } from './liveDisplay';
import type { LiveSession } from '../../types/analytics';
const visitor = { id: 'session', visitorId: 'visitor', country: 'AU', city: null, deviceType: 'mobile', os: 'OS', browser: 'Browser', currentPath: '/', lastActiveAt: '2026-10-20T12:00:00Z', cartValue: 20, cartItems: [], referrer: null, utmSource: null, utmCampaign: null } satisfies LiveSession;
beforeEach(() => { mocks.currency = 'EUR'; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('live analytics display accuracy', () => {
    it('uses the selected currency and offers a real profile button', () => {
        const click = vi.fn(); render(<VisitorsTable data={[visitor]} onVisitorClick={click} />);
        expect(screen.getByText(/EUR.*20/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'View visitor profile: visitor' })); expect(click).toHaveBeenCalledWith('visitor');
    });
    it('treats malformed money and timestamps as unavailable', () => {
        render(<VisitorsTable data={[{ ...visitor, cartValue: Infinity, lastActiveAt: 'invalid', country: 'not a code' }]} />);
        expect(screen.getByText('Unavailable')).toBeInTheDocument(); expect(screen.getByText('Time unavailable')).toBeInTheDocument(); expect(screen.getByRole('img', { name: 'Activity unavailable' })).toBeInTheDocument();
    });
    it('groups prototype-named countries safely and does not label cart values as revenue', () => {
        render(<AnalyticsOverview visitors={[{ ...visitor, country: '__proto__' }]} carts={[visitor]} setActiveView={vi.fn()} />);
        expect(screen.getByText('From __proto__')).toBeInTheDocument(); expect(screen.getByText('Current Cart Value (not revenue)')).toBeInTheDocument(); expect(screen.getAllByText(/EUR.*20/)).toHaveLength(2);
    });
    it('advances activity bins without a changed visitors array and cleans its timer', () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:30Z'));
        const view = render(<AnalyticsOverview visitors={[visitor]} carts={[]} setActiveView={vi.fn()} />);
        expect(screen.getByRole('img', { name: /oldest first: 0, 0, 0, 0, 0, 0, 0, 0, 0, 1/ })).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(60000); }); expect(screen.getByRole('img', { name: /oldest first: 0, 0, 0, 0, 0, 0, 0, 0, 1, 0/ })).toBeInTheDocument();
        view.unmount(); expect(vi.getTimerCount()).toBe(0);
    });
    it('validates numeric and currency inputs without unintended coercion', () => {
        expect(cartAmount(true)).toBeNull(); expect(cartAmount('0x10')).toBeNull(); expect(cartAmount(' 1.50 ')).toBe(1.5);
        expect(cartMoney(20, 'invalid')).toBe('Unavailable'); expect(flagEmoji('invalid')).toBe('🌍'); expect(flagEmoji('au')).toBe('🇦🇺');
    });
});
