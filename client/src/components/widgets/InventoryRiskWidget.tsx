import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface RiskProduct {
    id: string;
    wooId: number;
    name: string;
    stock: number;
    velocity: string;
    daysRemaining: number;
    image?: string;
}

export function InventoryRiskWidget() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [products, setProducts] = useState<RiskProduct[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!currentAccount) return;

        const fetchRisk = async () => {
            try {
                const res = await fetch('/api/analytics/health', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id
                    }
                });
                if (res.ok) {
                    setProducts(await res.json());
                }
            } catch (error) {
                console.error('Failed to load inventory risk', error);
            } finally {
                setLoading(false);
            }
        };

        fetchRisk();
    }, [currentAccount, token]);

    if (loading) return <div className="p-4 text-center text-xs text-gray-500">Analysis...</div>;

    if (products.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 p-4">
                <div className="bg-green-50 p-3 rounded-full mb-2">
                    <AlertTriangle className="w-5 h-5 text-green-500" />
                </div>
                <p className="text-sm font-medium text-gray-600">Healthy Stock</p>
                <p className="text-xs">No products at immediate risk.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4 px-1">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-500" />
                    Stock Risks
                </h3>
                <span className="text-xs font-mono bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                    {products.length} Critical
                </span>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                {products.slice(0, 5).map(p => (
                    <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                        {p.image ? (
                            <img src={p.image} alt="" className="w-10 h-10 rounded-md object-cover border border-gray-200" loading="lazy" />
                        ) : (
                            <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center text-gray-400">
                                <span className="text-xs">IMG</span>
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span className="font-mono text-red-600 font-bold">{p.daysRemaining} days left</span>
                                <span>•</span>
                                <span>{p.stock} units</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <a href="/inventory" className="mt-4 flex items-center justify-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 pt-2 border-t border-gray-100">
                View All Risks <ArrowRight size={12} />
            </a>
        </div>
    );
}
