import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnoozeModal } from './SnoozeModal';
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('snooze modal', () => {
    it('reports failures without closing and allows retry', async () => {
        const snooze = vi.fn().mockRejectedValueOnce(new Error('Failed')).mockResolvedValue(undefined); const close = vi.fn();
        render(<SnoozeModal isOpen onClose={close} onSnooze={snooze} />);
        fireEvent.click(screen.getByRole('button', { name: /10 minutes/ }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not snooze'));
        expect(close).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: /10 minutes/ }));
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
    });
    it('uses the expected deadline and prevents duplicate submissions', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
        let resolve!: () => void; const snooze = vi.fn(() => new Promise<void>(r => { resolve = r; }));
        render(<SnoozeModal isOpen onClose={vi.fn()} onSnooze={snooze} />);
        const button = screen.getByRole('button', { name: /30 minutes/ }); fireEvent.click(button); fireEvent.click(button);
        expect(snooze).toHaveBeenCalledOnce(); expect(snooze).toHaveBeenCalledWith(new Date('2026-10-20T12:30:00Z'));
        await act(async () => { resolve(); });
    });
    it('does not close a reopened dialog after an old action completes', async () => {
        let resolve!: () => void; const snooze = vi.fn(() => new Promise<void>(r => { resolve = r; })); const close = vi.fn();
        const view = render(<SnoozeModal isOpen onClose={close} onSnooze={snooze} />);
        fireEvent.click(screen.getByRole('button', { name: /10 minutes/ }));
        view.rerender(<SnoozeModal isOpen={false} onClose={close} onSnooze={snooze} />);
        view.rerender(<SnoozeModal isOpen onClose={close} onSnooze={snooze} />);
        await act(async () => { resolve(); }); expect(close).not.toHaveBeenCalled();
    });
});
