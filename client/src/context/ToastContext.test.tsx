import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastContext';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

it('keeps the context and all methods stable through toast additions and expiry', () => {
    vi.useFakeTimers();
    const values: ReturnType<typeof useToast>[] = [];
    function Consumer() {
        values.push(useToast());
        return null;
    }
    const tree = () => <ToastProvider><Consumer /></ToastProvider>;
    const { rerender } = render(tree());
    const initial = values[0];
    act(() => {
        initial.success('Saved');
        initial.error('Failed');
        initial.info('Notice');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(values).toHaveLength(1);
    rerender(tree());
    expect(values[values.length - 1]).toBe(initial);
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(tree());
    expect(values[values.length - 1]).toBe(initial);
});
