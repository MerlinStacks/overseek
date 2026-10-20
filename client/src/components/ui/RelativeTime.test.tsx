import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelativeTime } from './RelativeTime';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('relative time presentation', () => {
    it('provides a machine-readable timestamp and full-date tooltip', () => {
        const { container } = render(<RelativeTime date="2026-10-20T12:00:00Z" />); const time = container.querySelector('time');
        expect(time).toHaveAttribute('datetime', '2026-10-20T12:00:00.000Z'); expect(time?.getAttribute('title')).toBeTruthy();
    });
    it.each(['invalid', new Date(NaN), undefined])('safely suppresses an unavailable timestamp', date => {
        const { container } = render(<RelativeTime date={date} />); expect(container).toBeEmptyDOMElement();
    });
    it('bounds invalid update intervals and cleans timers', () => {
        vi.useFakeTimers(); const interval = vi.spyOn(globalThis, 'setInterval'); const view = render(<RelativeTime date="2026-10-20T12:00:00Z" interval={0} />);
        expect(interval).toHaveBeenCalledWith(expect.any(Function), 60000); view.unmount(); expect(vi.getTimerCount()).toBe(0);
    });
});
