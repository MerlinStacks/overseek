import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { DeliveryPreview } from './DeliveryPreview';
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const artifact = (subject: string) => ({ html: `<p>${subject}</p>`, canonicalHtml: `<p>${subject}</p>`, subject, text: subject, hash: 'a'.repeat(64), rendererVersion: 'test', assets: [], missingTags: [] });
describe('delivery preview request lifecycle', () => {
    it('does not publish a late response for an older design', async () => {
        vi.useFakeTimers();
        const pending: Array<(value: any) => void> = [];
        vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/marketing/preview-orders' ? Promise.resolve({ ok: true, json: async () => ({ orders: [] }) }) : new Promise(resolve => pending.push(resolve))));
        const prepared = vi.fn(); const first = createDefaultEmailDesignV2({ title: 'Old' });
        const view = render(<DeliveryPreview design={first} width={920} category="MARKETING" onPrepared={prepared} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(451); });
        const second = structuredClone(first); second.document.meta.title = 'New';
        view.rerender(<DeliveryPreview design={second} width={920} category="MARKETING" onPrepared={prepared} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(451); });
        await act(async () => { pending[1]({ ok: true, json: async () => artifact('New') }); });
        await act(async () => { pending[0]({ ok: true, json: async () => artifact('Old') }); });
        expect(screen.getByText('New')).toBeInTheDocument();
        expect(prepared.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
        view.unmount();
    });
    it('shows a recoverable timeout instead of an indefinite spinner', async () => {
        vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
        const view = render(<DeliveryPreview design={createDefaultEmailDesignV2()} width={920} category="MARKETING" onPrepared={vi.fn()} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(30001); });
        expect(screen.getByRole('alert')).toHaveTextContent('timed out');
        view.unmount();
    });
});
