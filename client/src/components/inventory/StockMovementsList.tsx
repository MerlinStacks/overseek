import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Boxes, Loader2, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';
import { EmptyState } from '../ui/EmptyState';

type StockMovement = {
    id: string;
    productName: string;
    sku: string | null;
    previousStock: number;
    newStock: number;
    quantity: number;
    type: string;
    reference: string | null;
    reason: string | null;
    createdAt: string;
    isBomProduct: boolean;
    bomParents: Array<{ id: string; name: string; variationId: number }>;
};

const TYPE_LABELS: Record<string, string> = {
    ADJUSTMENT: 'Manual adjustment',
    BOM_SYNC: 'BOM stock sync',
    ORDER_CONSUMPTION: 'Order consumption',
    ORDER_REVERSAL: 'Order reversal',
    PO_RECEIPT: 'PO receipt',
    PO_REVERSAL: 'PO reversal',
    SYNC: 'Stock sync'
};

function formatQuantity(value: number) {
    return `${value > 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

export function StockMovementsList() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [movements, setMovements] = useState<StockMovement[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadMovements = useCallback(async () => {
        if (!token || !currentAccount?.id) return;
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/inventory/stock-movements?limit=200', {
                headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
            });
            if (!response.ok) throw new Error('Failed to load stock movements');
            const data = await response.json() as { movements?: StockMovement[] };
            setMovements(data.movements || []);
        } catch (loadError) {
            Logger.error('Failed to load stock movements', { error: loadError });
            setError('Could not load stock movements.');
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount?.id, token]);

    useEffect(() => {
        void loadMovements();
    }, [loadMovements]);

    const query = search.trim().toLowerCase();
    const filtered = query
        ? movements.filter((movement) => [
            movement.productName,
            movement.sku,
            movement.reference,
            movement.reason,
            ...movement.bomParents.map((parent) => parent.name)
        ].some((value) => value?.toLowerCase().includes(query)))
        : movements;

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Stock movement history</h2>
                    <p className="text-sm text-gray-500">Individual receipts, adjustments, order deductions, reversals, and BOM updates.</p>
                </div>
                <div className="flex gap-2">
                    <div className="relative flex-1 sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search product, SKU, BOM or reference"
                            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-hidden focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => void loadMovements()}
                        disabled={isLoading}
                        aria-label="Refresh stock movements"
                        className="rounded-lg border border-gray-300 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs">
                {isLoading ? (
                    <div className="p-12 text-center"><Loader2 className="inline animate-spin text-blue-600" /></div>
                ) : error ? (
                    <div className="p-10 text-center text-sm text-red-600">{error}</div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={<Boxes size={48} />}
                        title={query ? 'No matching movements' : 'No stock movements yet'}
                        description={query ? 'Try a different product, SKU, BOM, or reference.' : 'Stock changes will appear here as they are recorded.'}
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-left">
                            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-gray-500">
                                <tr>
                                    <th className="px-5 py-3">Date</th>
                                    <th className="px-5 py-3">Product / BOM usage</th>
                                    <th className="px-5 py-3">Movement</th>
                                    <th className="px-5 py-3 text-right">Change</th>
                                    <th className="px-5 py-3 text-right">Stock</th>
                                    <th className="px-5 py-3">Reference</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filtered.map((movement) => {
                                    const hasBomContext = movement.isBomProduct || movement.bomParents.length > 0;
                                    return (
                                        <tr key={movement.id} className={hasBomContext ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-gray-50'}>
                                            <td className="whitespace-nowrap px-5 py-4 text-sm text-gray-600">
                                                <div>{new Date(movement.createdAt).toLocaleDateString()}</div>
                                                <div className="text-xs text-gray-400">{new Date(movement.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                            </td>
                                            <td className="px-5 py-4">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-medium text-gray-900">{movement.productName}</span>
                                                    {movement.isBomProduct && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-900">BOM product</span>}
                                                </div>
                                                {movement.sku && <div className="mt-0.5 font-mono text-xs text-gray-500">{movement.sku}</div>}
                                                {movement.bomParents.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-amber-900">
                                                        <Boxes size={14} />
                                                        <span>Used by</span>
                                                        {movement.bomParents.map((parent) => (
                                                            <span key={`${parent.id}:${parent.variationId}`} className="rounded bg-amber-200/80 px-1.5 py-0.5 font-medium">
                                                                {parent.name}{parent.variationId ? ` (variation #${parent.variationId})` : ''}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-5 py-4 text-sm text-gray-700">
                                                <div>{TYPE_LABELS[movement.type] || movement.type}</div>
                                                {movement.reason && <div className="mt-0.5 text-xs text-gray-500">{movement.reason}</div>}
                                            </td>
                                            <td className={`px-5 py-4 text-right font-semibold ${movement.quantity > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                                <span className="inline-flex items-center gap-1">
                                                    {movement.quantity > 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                                                    {formatQuantity(movement.quantity)}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-5 py-4 text-right text-sm text-gray-700">
                                                {movement.previousStock.toLocaleString()} <span className="text-gray-400">to</span> {movement.newStock.toLocaleString()}
                                            </td>
                                            <td className="px-5 py-4 font-mono text-sm text-gray-600">{movement.reference || '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
