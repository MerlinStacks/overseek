import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import { SchedulePickerModal } from './SchedulePickerModal';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('schedule picker lifecycle', () => {
    it('shows a rejected save without latching the successful-submit guard', async () => {
        const schedule = vi.fn().mockRejectedValue(new Error('Unavailable'));
        render(<SchedulePickerModal isOpen onClose={vi.fn()} onSchedule={schedule} />);
        fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Schedule' })); });
        expect(screen.getByRole('alert')).toHaveTextContent('Could not schedule');
        expect(screen.getByRole('button', { name: 'Schedule' })).not.toBeDisabled();
    });
    it('rejects a selection that became past before submission', () => {
        const schedule = vi.fn(); render(<SchedulePickerModal isOpen onClose={vi.fn()} onSchedule={schedule} />); fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' }));
        vi.setSystemTime(new Date('2026-10-20T14:00:00Z')); fireEvent.click(screen.getByRole('button', { name: 'Schedule' })); expect(schedule).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('future time');
    });
    it('refreshes presets and clears selection when reopened', () => {
        const schedule = vi.fn(); const props = { onClose: vi.fn(), onSchedule: schedule };
        const view = render(<SchedulePickerModal isOpen {...props} />); fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' })); view.rerender(<SchedulePickerModal isOpen={false} {...props} />);
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z')); view.rerender(<SchedulePickerModal isOpen {...props} />); expect(screen.getByRole('button', { name: 'Schedule' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' })); fireEvent.click(screen.getByRole('button', { name: 'Schedule' })); expect(schedule).toHaveBeenCalledWith(new Date('2026-10-21T13:00:00Z'));
    });
    it('serializes scheduling and disables changing inputs during a pending save', async () => {
        let resolve!: () => void; const schedule = vi.fn().mockReturnValue(new Promise<void>(r => { resolve = r; })); render(<SchedulePickerModal isOpen onClose={vi.fn()} onSchedule={schedule} />);
        fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' })); const button = screen.getByRole('button', { name: 'Schedule' }); fireEvent.click(button); fireEvent.click(button);
        expect(schedule).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Scheduled date')).toBeDisabled(); await act(async () => { resolve(); }); expect(screen.getByRole('button', { name: 'Schedule' })).toBeDisabled();
    });
});
