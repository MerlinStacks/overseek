import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeactivatedItemsBanner } from './DeactivatedItemsBanner';
afterEach(cleanup);
describe('BOM reactivation feedback', () => {
    it('keeps per-item pending state independent and exposes failures', async () => {
        const items = ['First', 'Second'].map(name => ({ id: name, bomId: name, parentProduct: { id: name, wooId: 1, name, variationId: 0 }, component: { type: 'Unknown' as const }, quantity: 1, deactivatedReason: '__proto__' }));
        let resolve!: () => void; let reject!: (reason: Error) => void;
        const reactivate = vi.fn().mockReturnValueOnce(new Promise<void>(r => { resolve = r; })).mockReturnValueOnce(new Promise<void>((_, r) => { reject = r; }));
        render(<DeactivatedItemsBanner items={items} onReactivate={reactivate} />); fireEvent.click(screen.getByRole('button', { expanded: false }));
        const first = screen.getByRole('button', { name: 'Reactivate component for First' }); const second = screen.getByRole('button', { name: 'Reactivate component for Second' }); fireEvent.click(first); fireEvent.click(second);
        await act(async () => { resolve(); }); expect(first).not.toBeDisabled(); expect(second).toBeDisabled();
        await act(async () => { reject(new Error('Unavailable')); }); expect(screen.getByRole('alert')).toHaveTextContent('remains disabled');
    });
});
