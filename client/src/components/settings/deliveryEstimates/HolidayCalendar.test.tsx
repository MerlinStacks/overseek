import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HolidayCalendar } from './HolidayCalendar';
import type { DeliverySettings } from './types';

function Harness({ disabled = false }: { disabled?: boolean }) {
    const [closures, setClosures] = useState<DeliverySettings['closures']>([{ date: '2026-09-23', scope: 'transit', label: 'Carrier holiday' }]);
    return <fieldset disabled={disabled}><HolidayCalendar closures={closures} onChange={setClosures} timezone="UTC" /><output data-testid="closures">{JSON.stringify(closures)}</output></fieldset>;
}
describe('holiday month calendar', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
        vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());
    it('selects a weekend, adds scoped closure, updates existing date without duplicates, and removes it', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Saturday, 26 September 2026: No closure' }));
        fireEvent.change(screen.getByLabelText('Selected date closure scope'), { target: { value: 'work' } });
        fireEvent.change(screen.getByLabelText('Selected date closure label'), { target: { value: 'Workshop closed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add selected closure' }));
        expect(screen.getByRole('button', { name: 'Saturday, 26 September 2026: Work only closure, Workshop closed' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.change(screen.getByLabelText('Selected date closure scope'), { target: { value: 'both' } });
        fireEvent.click(screen.getByRole('button', { name: 'Update selected closure' }));
        expect(JSON.parse(screen.getByTestId('closures').textContent!)).toEqual([
            { date: '2026-09-23', scope: 'transit', label: 'Carrier holiday' }, { date: '2026-09-26', scope: 'both', label: 'Workshop closed' },
        ]);
        fireEvent.click(screen.getByRole('button', { name: 'Remove selected closure' }));
        expect(screen.getByRole('button', { name: 'Saturday, 26 September 2026: No closure' })).toBeInTheDocument();
    });
    it('loads existing scope/label and navigates months and keyboard across boundaries', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: /Wednesday, 23 September 2026: Transit only/ }));
        expect(screen.getByLabelText('Selected date closure scope')).toHaveValue('transit');
        expect(screen.getByLabelText('Selected date closure label')).toHaveValue('Carrier holiday');
        fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
        expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Thursday, 1 October 2026: No closure' }), { key: 'ArrowLeft' });
        expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Wednesday, 30 September 2026: No closure' })).toHaveAttribute('aria-pressed', 'true');
        act(() => { vi.advanceTimersToNextFrame(); });
        expect(screen.getByRole('button', { name: 'Wednesday, 30 September 2026: No closure' })).toHaveFocus();
        fireEvent.keyDown(screen.getByRole('button', { name: 'Wednesday, 30 September 2026: No closure' }), { key: 'PageUp' });
        expect(screen.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
    });
    it('inherits read-only permissions from the settings fieldset', () => {
        render(<Harness disabled />);
        expect(screen.getByRole('button', { name: 'Add selected closure' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
        expect(screen.getByLabelText('Selected date closure scope')).toBeDisabled();
    });
});
