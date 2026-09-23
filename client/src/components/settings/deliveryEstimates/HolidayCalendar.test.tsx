import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HolidayCalendar } from './HolidayCalendar';
import type { DeliverySettings } from './types';

function Harness({ disabled = false }: { disabled?: boolean }) {
    const [closures, setClosures] = useState<DeliverySettings['closures']>([{ date: '2026-09-23', scope: 'transit', label: 'Carrier holiday' }]);
    return <fieldset disabled={disabled}>
        {(['work', 'transit'] as const).map(scope => <HolidayCalendar key={scope} scope={scope} closures={closures} onChange={setClosures} timezone="UTC" />)}
        <output data-testid="closures">{JSON.stringify(closures)}</output>
    </fieldset>;
}
const calendar = (title: string) => within(screen.getByRole('region', { name: `${title} closures` }));
const savedClosures = () => JSON.parse(screen.getByTestId('closures').textContent!);
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${date}T12:00:00Z`));

describe('holiday month calendars', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
        vi.setSystemTime(new Date('2026-09-22T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('toggles weekend closures independently and merges the same date without duplicates', () => {
        render(<Harness />);
        const production = calendar('Production');
        const transit = calendar('Transit');
        const date = dateLabel('2026-09-26');
        fireEvent.click(production.getByRole('button', { name: `${date}: No closure` }));
        expect(production.getByRole('button', { name: `${date}: Production closure` })).toHaveAttribute('aria-pressed', 'true');
        expect(transit.getByRole('button', { name: `${date}: No closure` })).toHaveAttribute('aria-pressed', 'false');
        expect(savedClosures()[1]).toEqual({ date: '2026-09-26', scope: 'work' });
        fireEvent.click(transit.getByRole('button', { name: `${date}: No closure` }));
        expect(savedClosures()).toEqual([
            { date: '2026-09-23', scope: 'transit', label: 'Carrier holiday' },
            { date: '2026-09-26', scope: 'both' },
        ]);
        fireEvent.click(production.getByRole('button', { name: `${date}: Production closure` }));
        expect(savedClosures()[1]).toEqual({ date: '2026-09-26', scope: 'transit' });
        fireEvent.click(transit.getByRole('button', { name: `${date}: Transit closure` }));
        expect(savedClosures()).toHaveLength(1);
    });

    it('preserves existing labels when merging and removing one calendar from both', () => {
        render(<Harness />);
        const date = dateLabel('2026-09-23');
        fireEvent.click(calendar('Production').getByRole('button', { name: `${date}: No closure` }));
        expect(savedClosures()).toEqual([{ date: '2026-09-23', scope: 'both', label: 'Carrier holiday' }]);
        fireEvent.click(calendar('Transit').getByRole('button', { name: `${date}: Transit closure, Carrier holiday` }));
        expect(savedClosures()).toEqual([{ date: '2026-09-23', scope: 'work', label: 'Carrier holiday' }]);
    });

    it('navigates independently with keyboard across month boundaries without changing closures', () => {
        render(<Harness />);
        const production = calendar('Production');
        fireEvent.click(production.getByRole('button', { name: 'Next month' }));
        expect(production.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
        expect(calendar('Transit').getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
        fireEvent.keyDown(production.getByRole('button', { name: `${dateLabel('2026-10-01')}: No closure` }), { key: 'ArrowLeft' });
        expect(production.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
        act(() => { vi.advanceTimersToNextFrame(); });
        const lastDay = production.getByRole('button', { name: `${dateLabel('2026-09-30')}: No closure` });
        expect(lastDay).toHaveFocus();
        expect(lastDay).toHaveAttribute('aria-pressed', 'false');
        fireEvent.keyDown(lastDay, { key: 'PageUp' });
        expect(production.getByRole('heading', { name: 'August 2026' })).toBeInTheDocument();
        expect(savedClosures()).toEqual([{ date: '2026-09-23', scope: 'transit', label: 'Carrier holiday' }]);
    });

    it('inherits read-only permissions from the settings fieldset', () => {
        render(<Harness disabled />);
        for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    });

    it('allows edits and removals at the limit, but prevents adding new dates', () => {
        const onChange = vi.fn();
        const closures: DeliverySettings['closures'] = Array.from({ length: 3660 }, (_, i) => ({
            date: new Date(Date.UTC(2026, 8, 23 + i)).toISOString().slice(0, 10), scope: 'both',
        }));
        render(<HolidayCalendar scope="work" closures={closures} onChange={onChange} timezone="UTC" />);
        expect(screen.getByRole('button', { name: `${dateLabel('2026-09-22')}: No closure` })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: `${dateLabel('2026-09-23')}: Production closure` }));
        expect(onChange.mock.calls[0][0][0]).toEqual({ date: '2026-09-23', scope: 'transit' });
    });
});
