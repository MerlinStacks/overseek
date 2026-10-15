import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsTable } from './ReportsTable';

const rows = [
    { url: 'https://example.com/gifts?one=1&two=2', title: 'Gifts, "special"\nédition', views: 12, entries: 8, exits: 3, exitRate: 25 },
    { url: 'https://example.com/account', title: 'Account', views: 20, entries: 19, exits: 18, exitRate: 90 },
];

let downloadedBlob: Blob;
let downloadName: string;
const createObjectURL = vi.fn((blob: Blob) => { downloadedBlob = blob; return 'blob:report'; });
const revokeObjectURL = vi.fn();

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
        expect(this.href).toBe('blob:report');
        expect(this.isConnected).toBe(true);
    });
});

afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

async function exportedCsv() {
    // jsdom's Blob supports FileReader rather than Blob.text().
    const result = new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(downloadedBlob);
    });
    return result;
}

describe('Pages CSV export', () => {
    it('downloads full values with CSV escaping, report columns and current sort order', async () => {
        render(<ReportsTable data={rows} loading={false} activeView="pages" dateRange="7d" />);
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

        const csv = await exportedCsv();
        expect(downloadedBlob.type).toBe('text/csv;charset=utf-8;');
        expect(downloadName).toMatch(/^pages_7d_\d{4}-\d{2}-\d{2}\.csv$/);
        expect(csv).toBe([
            '"Page URL","Title","Views","Entries","Exits","Exit %"',
            '"https://example.com/account","Account","20","19","18","90.00%"',
            '"https://example.com/gifts?one=1&two=2","Gifts, ""special""\nédition","12","8","3","25.00%"',
        ].join('\r\n'));
        expect(document.querySelector('a[download]')).toBeNull();
        expect(revokeObjectURL).not.toHaveBeenCalled();
        vi.runOnlyPendingTimers();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    });

    it('respects the page filter and changed sort direction', async () => {
        render(<ReportsTable data={rows} loading={false} activeView="pages" />);
        fireEvent.click(screen.getByRole('button', { name: 'Views' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        const sortedCsv = await exportedCsv();
        expect(sortedCsv.indexOf('example.com/gifts')).toBeLessThan(sortedCsv.indexOf('example.com/account'));

        fireEvent.change(screen.getByPlaceholderText('Filter pages by URL or title...'), { target: { value: 'ACCOUNT' } });
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        const csv = await exportedCsv();
        expect(csv).toContain('example.com/account');
        expect(csv).not.toContain('example.com/gifts');
    });

    it('uses display defaults and neutralizes spreadsheet formulas', async () => {
        render(<ReportsTable data={[{ url: '=HYPERLINK("bad")', title: '  +SUM(1,2)' }, {}]} loading={false} activeView="pages" />);
        fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
        const csv = await exportedCsv();
        expect(csv).toContain('"\'=HYPERLINK(""bad"")","\'  +SUM(1,2)","0","0","0","0.00%"');
        expect(csv).toContain('"","Untitled","0","0","0","0.00%"');
    });

    it('prevents empty or unmatched exports and hides the action while loading or in other views', () => {
        const view = render(<ReportsTable data={[]} loading={false} activeView="pages" />);
        expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
        view.rerender(<ReportsTable data={rows} loading={false} activeView="pages" />);
        fireEvent.change(screen.getByPlaceholderText('Filter pages by URL or title...'), { target: { value: 'missing' } });
        expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
        view.rerender(<ReportsTable data={rows} loading={true} activeView="pages" />);
        expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
        view.rerender(<ReportsTable data={[]} loading={false} activeView="channels" />);
        expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
        expect(createObjectURL).not.toHaveBeenCalled();
    });
});
