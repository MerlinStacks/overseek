import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DateRangeFilter } from './analytics/DateRangeFilter';
import { DeviceBrowserBadge } from './analytics/DeviceBrowserIcons';
import { SupplierSearchInput } from './inventory/SupplierSearchInput';
import { SyncProductRow } from './bom/SyncProductRow';
import { InboxSkeleton } from './chat/InboxSkeleton';
afterEach(cleanup);
it('date filters never submit the surrounding form', () => {
    const submit = vi.fn(); render(<form onSubmit={submit}><DateRangeFilter value="30d" onChange={vi.fn()} /></form>);
    screen.getAllByRole('button').forEach(button => { expect(button).toHaveAttribute('type', 'button'); fireEvent.click(button); });
    expect(submit).not.toHaveBeenCalled(); expect(screen.getByRole('group')).toHaveAccessibleName('Reporting date range');
});
it('labels unknown devices without presenting them as desktop', () => {
    render(<DeviceBrowserBadge deviceType="other" browser="Samsung Chrome" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/Unknown device.*Samsung Chrome/);
});
it('keeps the supplier input mounted and selects the first option when reopened', () => {
    const change = vi.fn(); render(<SupplierSearchInput value="" suppliers={[{ id: 'a', name: 'Alpha', currency: 'USD' }, { id: 'b', name: 'Beta', currency: 'USD' }]} onChange={change} />);
    const input = screen.getByRole('combobox'); fireEvent.focus(input); fireEvent.keyDown(input, { key: 'Escape' }); fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(change).toHaveBeenCalledWith('a'); expect(screen.getByRole('combobox')).toBe(input);
});
it('disabled supplier controls cannot clear, select or create', () => {
    const change = vi.fn(), create = vi.fn(); render(<SupplierSearchInput disabled value="a" suppliers={[{ id: 'a', name: 'Alpha', currency: 'USD' }]} onChange={change} onCreateNew={create} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear supplier' })); fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(change).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(screen.queryByRole('listbox')).toBeNull();
});
it('does not turn unknown Woo stock into zero or allow syncing it', () => {
    const sync = vi.fn(); render(<SyncProductRow item={{ productId: 'a', wooId: 1, name: 'Kit', sku: null, mainImage: null, variationId: 0, currentWooStock: null, effectiveStock: 5, needsSync: true, components: [{ childName: 'Part', requiredQty: 1, childStock: 5, buildableUnits: 5 }] }} isExpanded isSyncingThis={false} isSyncingAll={false} errorMsg={null} onToggleExpand={vi.fn()} onSync={sync} />);
    expect(screen.getByRole('button', { name: 'Sync Kit' })).toBeDisabled(); expect(screen.getByText(/Unknown values are not zero/)).toBeInTheDocument();
});
it('exposes one named loading status for the responsive inbox', () => {
    render(<InboxSkeleton />); expect(screen.getAllByRole('status')).toHaveLength(1); expect(screen.getByRole('status')).toHaveAccessibleName('Loading inbox');
});
