import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a', currency: 'EUR', goldPrice18ct: '20' as string | null }, enabled: true, permission: true }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => m.enabled }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => m.permission }) }));
import { GoldPricePanel } from './GoldPricePanel';
beforeEach(() => { m.account = { id: 'a', currency: 'EUR', goldPrice18ct: '20' }; m.enabled = true; m.permission = true; });
afterEach(cleanup);
const props = { product: { weight: '2', goldPriceType: '18ct' as const, isGoldPriceApplied: true }, onChange: vi.fn() };
describe('gold price financial safeguards', () => {
    it('does not relabel a foreign gold rate as account-currency money', () => {
        Object.assign(m.account, { goldPriceCurrency: 'USD' }); render(<GoldPricePanel {...props} />);
        expect(screen.getByRole('status')).toHaveTextContent('No currency conversion'); expect(screen.getAllByText(/USD.*\$/).length).toBeGreaterThan(1);
    });
    it('labels costs with account currency and supports its associated selector label', () => {
        const change = vi.fn(); render(<GoldPricePanel {...props} onChange={change} />); expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(1);
        fireEvent.change(screen.getByLabelText('Gold Type:'), { target: { value: 'none' } }); expect(change).toHaveBeenCalledWith({ isGoldPriceApplied: false, goldPriceType: null });
    });
    it.each(['2junk', '-2', 'Infinity', ''])('does not calculate cost from invalid weight %s', weight => {
        render(<GoldPricePanel {...props} product={{ ...props.product, weight }} />); expect(screen.getByRole('status')).toHaveTextContent('Cost cannot be calculated'); expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    });
    it('distinguishes an absent configured rate from explicit zero', () => {
        m.account.goldPrice18ct = null; const view = render(<GoldPricePanel {...props} />); expect(screen.getByRole('status')).toBeInTheDocument();
        m.account.goldPrice18ct = '0'; view.rerender(<GoldPricePanel {...props} />); expect(screen.queryByRole('status')).toBeNull();
        const cost = screen.getByText('Calculated COGS').parentElement!; expect(within(cost).getByText(/EUR.*0/)).toBeInTheDocument();
    });
    it('hides financial controls without the feature or COGS permission', () => {
        m.permission = false; const view = render(<GoldPricePanel {...props} />); expect(screen.queryByRole('combobox')).toBeNull();
        m.permission = true; m.enabled = false; view.rerender(<GoldPricePanel {...props} />); expect(screen.queryByRole('combobox')).toBeNull();
    });
});
