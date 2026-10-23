import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ fetch: vi.fn(), allowed: true }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 'u' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a', currency: 'AUD' } }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => m.allowed }) }));
import { DataNote } from './DataNote';
import { EmailAccountForm } from '../settings/EmailAccountForm';
import { MergeCustomerModal } from '../customers/MergeCustomerModal';
import { VariantTableRow } from '../products/VariantTableRow';
import { BOMItemsTable } from '../products/bom/BOMItemsTable';
import { ShippingHubPage } from '../../pages/shipping/ShippingHubPage';

beforeEach(() => { vi.clearAllMocks(); m.allowed = true; vi.stubGlobal('fetch', m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

it('puts secondary methodology in a keyboard-accessible disclosure', () => {
    render(<DataNote title="Methodology">Recorded data is not complete.</DataNote>);
    const disclosure = screen.getByText('Methodology').closest('details')!;
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Methodology'));
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText('Recorded data is not complete.')).toBeVisible();
});

const emailProps = () => ({ initialData: { id: 'mail', accountId: 'a', name: 'Support', email: 'help@example.test', smtpPassword: 'masked', imapPassword: 'masked' }, onSave: vi.fn().mockResolvedValue(undefined), onCancel: vi.fn(), onTest: vi.fn(), isSaving: false, isTesting: false, testResult: null });
it('groups outgoing/incoming email controls while keeping saved secrets blank', () => {
    render(<EmailAccountForm {...emailProps()} />);
    const smtp = screen.getByRole('region', { name: 'SMTP configuration' });
    const imap = screen.getByRole('region', { name: 'IMAP configuration' });
    expect(within(smtp).getByLabelText(/SMTP Password/)).toHaveValue('');
    expect(within(imap).getByLabelText(/IMAP Password/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save reviewed account' })).toHaveClass('bg-[var(--primary-color)]', 'text-[var(--primary-foreground)]');
    expect(m.fetch).not.toHaveBeenCalled();
});
it('locks all email configuration inputs and actions while saving', () => {
    render(<EmailAccountForm {...emailProps()} isSaving />);
    expect(screen.getByLabelText('SMTP Host')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review SMTP connection test' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save reviewed account' })).toBeDisabled();
});

it('shows the retained customer separately from selectable destructive merge sources', async () => {
    const customer = (id: string) => ({ id, wooId: id === 'target' ? 1 : 2, firstName: id, lastName: 'Customer', email: 'same@example.test', updatedAt: '2026-10-22T00:00:00.000Z' });
    m.fetch.mockResolvedValue(response({ target: customer('target'), duplicates: [customer('source')], truncated: false }));
    render(<MergeCustomerModal isOpen customerId="target" onClose={vi.fn()} onMergeComplete={vi.fn()} />);
    const keep = await screen.findByRole('region', { name: 'Customer to keep' });
    expect(keep).toHaveTextContent('target Customer');
    const merge = screen.getByRole('button', { name: 'Merge & Delete' });
    expect(merge).toHaveClass('text-red-700');
    expect(merge).toBeDisabled();
    fireEvent.click(screen.getByRole('radio'));
    expect(merge).toBeEnabled();
    expect(screen.getByText(/selected source record will be deleted locally/)).toBeVisible();
    expect(m.fetch).toHaveBeenCalledTimes(1);
});

it('retains nine variant columns, accessible stock actions and disabled/zero behavior', () => {
    render(<table><tbody><VariantTableRow variant={{ id: 1, sku: 'SKU', price: '10', manageStock: true, stockQuantity: 0, attributes: [] }} isExpanded={false} onToggleExpand={vi.fn()} onFieldChange={vi.fn()} stockEditValue="0" onStockEditChange={vi.fn()} onStockAdjust={vi.fn()} onStockSave={vi.fn()} isSavingStock={false} /></tbody></table>);
    expect(screen.getAllByRole('cell')).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Expand variant 1' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Decrease stock for variant 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase stock for variant 1' })).toHaveClass('border');
    expect(screen.getByRole('button', { name: 'Save stock for variant 1' })).toBeDisabled();
});
it('keeps BOM editing and destructive controls disabled with the containing fieldset', () => {
    render(<BOMItemsTable disabled items={[{ id: 'part', displayName: 'Part', quantity: 1, wasteFactor: 0, cost: 0 }]} selectedScope={0} onItemsChange={vi.fn()} currency="AUD" />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getByRole('spinbutton', { name: 'Quantity for Part' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Part' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Part' })).toHaveClass('text-red-700');
});

it('filters dispatch cards without triggering carrier writes and distinguishes no matches', async () => {
    const dispatch = { accountId: 'a', dispatchStatus: 'In Dispatch', basis: 'local', partial: false, policy: null, orders: [{ order: { id: 'order', accountId: 'a', wooId: 42, updatedAt: '2026-10-22T00:00:00.000Z', number: '42', status: 'processing', total: '10.00', currency: 'AUD', dateCreated: '2026-10-22T00:00:00.000Z' }, draft: null }] };
    m.fetch.mockImplementation(async (url: string) => response(url.includes('/dispatch') ? dispatch : url.includes('/catalog') ? { accountId: 'a', partial: false, packages: [], overrides: [] } : { accountId: 'a', carrierAccount: null }));
    render(<MemoryRouter><ShippingHubPage /></MemoryRouter>);
    const prepare = await screen.findByRole('button', { name: 'Prepare local draft for 42' });
    expect(prepare).toHaveClass('border');
    const search = screen.getByLabelText('Filter this order window');
    fireEvent.change(search, { target: { value: 'not-here' } });
    expect(screen.getByText('No orders match this filter.')).toBeVisible();
    expect(screen.queryByText('No local orders in this acknowledged dispatch window.')).toBeNull();
    expect(m.fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});
