import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/Modal', () => ({ Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div role="dialog">{children}</div> : null }));
vi.mock('../settings/CannedResponsesSettings', () => ({ CannedResponsesSettings: ({ onUpdate }: { onUpdate?: () => void }) => <button onClick={onUpdate}>Shared editor</button> }));
import { CannedResponsesManager } from './CannedResponsesManager';
afterEach(cleanup);
describe('shared canned-response modal', () => {
    it('uses the hardened shared editor only while open and preserves its update callback', () => {
        const update = vi.fn(); const view = render(<CannedResponsesManager isOpen onClose={vi.fn()} onUpdate={update} />); fireEvent.click(screen.getByRole('button', { name: 'Shared editor' })); expect(update).toHaveBeenCalledOnce();
        view.rerender(<CannedResponsesManager isOpen={false} onClose={vi.fn()} onUpdate={update} />); expect(screen.queryByRole('dialog')).toBeNull();
    });
});
