import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('toast expiry and accessibility', () => {
    it('does not reset expiry when callback identity changes', () => {
        vi.useFakeTimers(); const first = vi.fn(); const latest = vi.fn(); const view = render(<Toast message="Saved" isVisible onClose={first} />);
        act(() => { vi.advanceTimersByTime(2000); }); view.rerender(<Toast message="Saved" isVisible onClose={latest} />); act(() => { vi.advanceTimersByTime(1000); });
        expect(latest).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Dismiss notification' })).toHaveAttribute('type', 'button');
    });
    it('announces non-errors politely and errors urgently', () => { const view = render(<Toast message="Saved" isVisible onClose={vi.fn()} />); expect(screen.getByRole('status')).toHaveTextContent('Saved'); view.rerender(<Toast message="Failed" type="error" isVisible onClose={vi.fn()} />); expect(screen.getByRole('alert')).toHaveTextContent('Failed'); });
});
