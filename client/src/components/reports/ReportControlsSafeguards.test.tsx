import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, generate: vi.fn(), save: vi.fn(), schedule: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../services/AnalyticsService', () => ({ AnalyticsService: { generateReport: m.generate, saveTemplate: m.save, createSchedule: m.schedule } }));
vi.mock('./ReportResults', () => ({ ReportResults: ({ results, metrics }: { results: unknown[]; metrics: string[] }) => <output data-testid="results">{JSON.stringify({ results, metrics })}</output> }));
import { ReportBuilder } from '../ReportBuilder';
import { SaveReportModal } from './SaveReportModal';
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a' }; });
afterEach(cleanup);
describe('report save controls', () => {
    it('validates names and schedule recipients, and resets the day when frequency changes', async () => {
        const save = vi.fn().mockResolvedValue(undefined); render(<SaveReportModal isOpen onClose={vi.fn()} onSave={save} />);
        fireEvent.change(screen.getByLabelText('Template Name'), { target: { value: '   ' } }); expect(screen.getByRole('button', { name: 'Save Template' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Template Name'), { target: { value: ' Report ' } }); fireEvent.click(screen.getByLabelText('Schedule Email Report'));
        fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'MONTHLY' } }); fireEvent.change(screen.getByLabelText('Day of Month'), { target: { value: '28' } }); fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'WEEKLY' } }); expect(screen.getByLabelText('Day of Week')).toHaveValue('1');
        fireEvent.click(screen.getByRole('button', { name: 'Save Template' })); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('valid recipients');
        fireEvent.change(screen.getByLabelText('Recipients (comma separated)'), { target: { value: 'one@test.example, one@test.example' } }); fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
        await screen.findByText('Save confirmed.'); expect(save.mock.calls[0][0]).toMatchObject({ name: 'Report', schedule: { dayOfWeek: 1, emailRecipients: ['one@test.example'] } });
    });
    it('serializes saves and preserves the draft on rejection', async () => {
        let reject!: (error: Error) => void; const save = vi.fn(() => new Promise<void>((_, r) => { reject = r; })); render(<SaveReportModal isOpen onClose={vi.fn()} onSave={save} />);
        fireEvent.change(screen.getByLabelText('Template Name'), { target: { value: 'Draft' } }); const button = screen.getByRole('button', { name: 'Save Template' }); fireEvent.click(button); fireEvent.click(button); expect(save).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Template Name')).toBeDisabled();
        await act(async () => { reject(new Error('Failed')); }); expect(screen.getByRole('alert')).toHaveTextContent('input is retained'); expect(screen.getByLabelText('Template Name')).toHaveValue('Draft');
    });
    it('reuses the confirmed template after scheduling fails', async () => {
        m.save.mockResolvedValue({ id: 'template', name: 'Report' }); m.schedule.mockRejectedValueOnce(new Error('Schedule failed')).mockResolvedValue(undefined);
        render(<ReportBuilder />); fireEvent.click(screen.getByRole('button', { name: 'Save' })); fireEvent.change(screen.getByLabelText('Template Name'), { target: { value: 'Report' } }); fireEvent.click(screen.getByLabelText('Schedule Email Report')); fireEvent.change(screen.getByLabelText('Recipients (comma separated)'), { target: { value: 'one@test.example' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Template' })); await screen.findByRole('alert'); expect(screen.getByText(/already saved/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save Template' })); await screen.findByText('Save confirmed.'); expect(m.save).toHaveBeenCalledOnce(); expect(m.schedule).toHaveBeenCalledTimes(2); expect(m.schedule.mock.calls[1][2].templateId).toBe('template');
    });
});
describe('report scope and result labelling', () => {
    it('runs automatically only once and hides results when settings change', async () => {
        m.generate.mockResolvedValue([{ dimension: 'Today', sales: 20 }]); render(<ReportBuilder autoRun />);
        await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent('Today')); expect(m.generate).toHaveBeenCalledOnce();
        fireEvent.change(screen.getByLabelText('Group By'), { target: { value: 'product' } }); await waitFor(() => expect(m.generate).toHaveBeenCalledTimes(2));
    });
    it('aborts old-account reports and ignores their late results', async () => {
        let resolve!: (value: unknown) => void; m.generate.mockReturnValueOnce(new Promise(r => { resolve = r; })); const view = render(<ReportBuilder />); fireEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
        expect(screen.getByLabelText('Group By')).toBeDisabled(); const signal = m.generate.mock.calls[0][3].signal;
        m.account = { id: 'b' }; view.rerender(<ReportBuilder />); await act(async () => { resolve([{ dimension: 'Old account', sales: 20 }]); }); expect(signal.aborted).toBe(true); expect(screen.getByTestId('results')).not.toHaveTextContent('Old account');
    });
});
