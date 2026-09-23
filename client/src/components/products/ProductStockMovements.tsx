import { useEffect, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface Movement {
    id: string;
    productName: string;
    sku: string | null;
    type: string;
    quantity: number;
    previousStock: number | null;
    newStock: number | null;
    orderId: number | null;
    reference: string | null;
    reason: string | null;
    createdAt: string;
}

interface MovementResponse {
    movements: Movement[];
    total: number;
    page: number;
    totalPages: number;
}

const labels: Record<string, string> = {
    SALE: 'Sale', ADJUSTMENT: 'Adjustment', BOM_SYNC: 'BOM stock sync',
    ORDER_CONSUMPTION: 'Order consumption', ORDER_REVERSAL: 'Order reversal',
    PO_RECEIPT: 'Purchase order receipt', PO_REVERSAL: 'Purchase order reversal', SYNC: 'Stock sync'
};

export function ProductStockMovements({ productId }: { productId: string }) {
    const { currentAccount } = useAccount();
    // Remount pagination and cancel requests whenever the product/account changes.
    return <MovementHistory key={`${currentAccount?.id}:${productId}`} productId={productId} />;
}

function MovementHistory({ productId }: { productId: string }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [page, setPage] = useState(1);
    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState<MovementResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!accountId || !token) return;
        const controller = new AbortController();
        setLoading(true);
        setError(false);
        const load = async () => {
            try {
                const query = new URLSearchParams({ productId, page: String(page), limit: '15' });
                const response = await fetch(`/api/inventory/stock-movements?${query}`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId },
                    signal: controller.signal
                });
                if (!response.ok) throw new Error('Failed to load stock movements');
                const result: MovementResponse = await response.json();
                if (!controller.signal.aborted) setData(result);
            } catch {
                if (!controller.signal.aborted) setError(true);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        void load();
        return () => controller.abort();
    }, [productId, accountId, token, page, attempt]);

    return (
        <section className="bg-white/70 dark:bg-slate-800/80 rounded-xl border border-gray-200 dark:border-slate-700 shadow-xs">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <ArrowLeftRight size={16} className="text-indigo-600" /> Stock Movement
                </h3>
                {!loading && !error && data && <span className="text-xs text-gray-500 dark:text-gray-400">{data.total} movements</span>}
            </div>
            {loading ? (
                <div role="status" className="p-8 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400"><Loader2 size={18} className="animate-spin" /> Loading stock movements...</div>
            ) : error ? (
                <div role="alert" className="p-8 text-center text-gray-600 dark:text-gray-300">
                    <p>Unable to load stock movements.</p>
                    <button onClick={() => setAttempt(value => value + 1)} className="mt-3 text-indigo-600 dark:text-indigo-400 underline">Try again</button>
                </div>
            ) : !data?.movements.length ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">No recorded stock movements for this product yet.</div>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-gray-700 dark:text-gray-300">
                            <thead className="bg-gray-50 dark:bg-slate-900/50 text-xs uppercase text-gray-500 dark:text-gray-400">
                                <tr>{['Date', 'Product / Variation', 'Movement', 'Change', 'Before', 'After', 'Reference'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                {data.movements.map(movement => (
                                    <tr key={movement.id}>
                                        <td className="px-4 py-3 whitespace-nowrap">{format(new Date(movement.createdAt), 'MMM d, yyyy')}<span className="block text-xs text-gray-500">{format(new Date(movement.createdAt), 'h:mm a')}</span></td>
                                        <td className="px-4 py-3">{movement.productName}{movement.sku && <span className="block text-xs text-gray-500">{movement.sku}</span>}</td>
                                        <td className="px-4 py-3">{labels[movement.type] || movement.type.replaceAll('_', ' ')}{movement.reason && <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{movement.reason}</span>}</td>
                                        <td className={`px-4 py-3 font-semibold ${movement.quantity > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td>
                                        <td className="px-4 py-3">{movement.previousStock ?? '—'}</td>
                                        <td className="px-4 py-3">{movement.newStock ?? '—'}</td>
                                        <td className="px-4 py-3">{movement.orderId ? <Link to={`/orders/${movement.orderId}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{movement.reference || `#${movement.orderId}`}</Link> : movement.reference || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {data.totalPages > 1 && <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between text-gray-600 dark:text-gray-300">
                        <span className="text-sm">Page {data.page} of {data.totalPages}</span>
                        <div className="flex gap-2">
                            <button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="p-2 border rounded-lg disabled:opacity-40"><ChevronLeft size={16} /></button>
                            <button aria-label="Next page" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)} className="p-2 border rounded-lg disabled:opacity-40"><ChevronRight size={16} /></button>
                        </div>
                    </div>}
                </>
            )}
        </section>
    );
}
