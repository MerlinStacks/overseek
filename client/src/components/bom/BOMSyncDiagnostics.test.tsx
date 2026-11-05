import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOMSyncDiagnostics } from './BOMSyncDiagnostics';

let accountId = 'account';
let canManage = true;
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: accountId }, activePermissions: { manage_inventory: canManage } }) }));
const response = (data: unknown, status = 200) => ({ ok: status < 400, json: async () => data }) as Response;
const details = {
    fingerprint: 'a'.repeat(64), canReconcile: true,
    runs: [{ jobId: 'bom_sync_account', state: 'failed', finishedAt: '2026-11-05T00:00:00Z', cause: 'The worker lost its lock.', hasCheckpoint: false, affectedCount: 0, products: [] }]
};

describe('BOM reconciliation UI', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const onReconciled = vi.fn();
    beforeEach(() => {
        accountId = 'account'; canManage = true; onReconciled.mockClear();
        fetchMock = vi.fn(async (url: string) => response(url.endsWith('sync-diagnostics') ? details : { success: true, auditId: 'audit' }));
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    it('shows legacy limitations and requires notes plus both safety checks before releasing', async () => {
        render(<BOMSyncDiagnostics onReconciled={onReconciled} />);
        await screen.findByText(/This older run retained counters only/);
        expect(screen.getByText(/Run: bom_sync_account/)).toBeTruthy();
        const submit = screen.getByRole('button', { name: 'Complete inventory review & unlock' });
        expect((submit as HTMLButtonElement).disabled).toBe(true);
        fireEvent.change(screen.getByLabelText('Inventory review notes (required)'), { target: { value: 'Reviewed physical and live component stock for all BOMs.' } });
        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        expect((submit as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getAllByRole('checkbox')[1]);
        fireEvent.click(submit);
        await waitFor(() => expect(onReconciled).toHaveBeenCalledOnce());
        const [, request] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('sync-reconcile'))!;
        expect(JSON.parse((request as RequestInit).body as string)).toEqual({ fingerprint: details.fingerprint, notes: 'Reviewed physical and live component stock for all BOMs.', confirmedStoppedAndSettled: true, confirmedInventoryReviewed: true });
    });

    it('lets non-managers see cause and guidance without offering an unlock action', async () => {
        canManage = false;
        render(<BOMSyncDiagnostics onReconciled={onReconciled} />);
        await screen.findByText(/Run: bom_sync_account/);
        expect(screen.getByText(/Ask an administrator with inventory management permission/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Complete inventory review & unlock' })).toBeNull();
    });

    it('links the actual product and shows variation and reason from retained evidence', async () => {
        fetchMock.mockResolvedValue(response({ ...details, runs: [{ ...details.runs[0], hasCheckpoint: true, affectedCount: 1,
            products: [{ productId: 'parent', variationId: 54535, name: 'Chopping board', sku: 'BOARD', available: true, reason: 'Stock write outcome unknown.' }]
        }] }));
        render(<BOMSyncDiagnostics onReconciled={onReconciled} />);
        expect((await screen.findByRole('link', { name: 'Chopping board' })).getAttribute('href')).toBe('/inventory/product/parent');
        expect(screen.getByText(/Variation: 54535/)).toBeTruthy();
        expect(screen.getByText('Stock write outcome unknown.')).toBeTruthy();
    });

    it('resets confirmations after an unacknowledged submission and refreshes authoritative status', async () => {
        fetchMock.mockImplementation(async (url: string) => url.endsWith('sync-diagnostics') ? response(details) : response({ error: 'Review was not acknowledged. Refresh status.' }, 503));
        render(<BOMSyncDiagnostics onReconciled={onReconciled} />);
        await screen.findByText(/Run: bom_sync_account/);
        fireEvent.change(screen.getByLabelText('Inventory review notes (required)'), { target: { value: 'Reviewed physical and live stock for all BOM products.' } });
        screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
        fireEvent.click(screen.getByRole('button', { name: 'Complete inventory review & unlock' }));
        await screen.findByText('Review was not acknowledged. Refresh status.');
        expect(onReconciled).toHaveBeenCalledOnce();
        expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true);
    });

    it('ignores a late response after switching accounts and resets review state', async () => {
        let resolve!: (value: Response) => void;
        fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
        const view = render(<BOMSyncDiagnostics onReconciled={onReconciled} />);
        accountId = 'other';
        fetchMock.mockResolvedValue(response({ ...details, runs: [] }));
        view.rerender(<BOMSyncDiagnostics onReconciled={onReconciled} />);
        await act(async () => resolve(response(details)));
        expect(screen.queryByText(/Run: bom_sync_account/)).toBeNull();
        expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true);
    });

    it('offers automatic repair without inventory notes when source settlement is already known', async () => {
        const onRepair = vi.fn().mockResolvedValue(undefined);
        fetchMock.mockResolvedValue(response({ ...details, repair: { canStart: true, requiresStoppedConfirmation: false } }));
        render(<BOMSyncDiagnostics onReconciled={onReconciled} onRepair={onRepair} />);
        await screen.findByText(/Recorded component stock and configured mappings/);
        await waitFor(() => expect((screen.getByRole('button', { name: 'Repair & resume' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Repair & resume' }));
        await waitFor(() => expect(onRepair).toHaveBeenCalledExactlyOnceWith(details.fingerprint, false));
        expect(onReconciled).not.toHaveBeenCalled();
    });

    it('asks only for old-worker settlement when a legacy run cannot prove that fact', async () => {
        const onRepair = vi.fn().mockResolvedValue(undefined);
        fetchMock.mockResolvedValue(response({ ...details, repair: { canStart: true, requiresStoppedConfirmation: true } }));
        render(<BOMSyncDiagnostics onReconciled={onReconciled} onRepair={onRepair} />);
        const check = await screen.findByRole('checkbox', { name: /The older run cannot prove/ });
        const button = screen.getByRole('button', { name: 'Repair & resume' });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(check); fireEvent.click(button);
        await waitFor(() => expect(onRepair).toHaveBeenCalledExactlyOnceWith(details.fingerprint, true));
        expect((screen.getByLabelText('Inventory review notes (required)') as HTMLTextAreaElement).value).toBe('');
    });

    it('shows specific repair exceptions with the product, variation and corrective action', async () => {
        fetchMock.mockResolvedValue(response({ ...details, repair: { canStart: true, requiresStoppedConfirmation: false }, repairResult: {
            total: 2, checked: 2, repaired: 1, unchanged: 0, failed: 1, verified: false,
            issues: [{ productId: 'board', variationId: 54535, name: 'Chopping board', sku: 'BOARD', code: 'BOM_REPAIR_TARGET_INVALID', message: 'Check the target’s stock-management settings.' }]
        } }));
        render(<BOMSyncDiagnostics onReconciled={onReconciled} onRepair={vi.fn()} />);
        const link = await screen.findByRole('link', { name: 'Chopping board' });
        expect(link.getAttribute('href')).toBe('/inventory/product/board');
        expect(screen.getByText(/Last repair: 1 repaired/)).toBeTruthy();
        expect(screen.getByText(/Variation: 54535/)).toBeTruthy();
        expect(screen.getByText('Check the target’s stock-management settings.')).toBeTruthy();
    });
});
