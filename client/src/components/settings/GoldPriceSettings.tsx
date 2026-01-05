import { useState, useEffect } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';


export function GoldPriceSettings() {
    const { currentAccount, refreshAccounts } = useAccount();
    const isEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const [isLoading, setIsLoading] = useState(false);
    const [priceInput, setPriceInput] = useState(currentAccount?.goldPrice?.toString() || '0');

    // Sync input when account updates (e.g. from Refresh)
    useEffect(() => {
        if (currentAccount?.goldPrice !== undefined) {
            setPriceInput(currentAccount.goldPrice.toString());
        }
    }, [currentAccount?.goldPrice]);

    if (!isEnabled) return null;

    const handleRefresh = async () => {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}` // Simple auth grab
                },
                body: JSON.stringify({ refreshGoldPrice: true })
            });
            if (res.ok) {
                await refreshAccounts(); // Update context
                // Update local input
                const updated = await res.json();
                setPriceInput(updated.goldPrice.toString());
            } else {
                alert('Failed to fetch live price');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveManual = async () => {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ goldPrice: priceInput })
            });
            if (res.ok) {
                await refreshAccounts();
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-medium text-gray-900">Gold Price Configuration</h2>
                    <p className="text-sm text-gray-500 mt-1">Manage the base gold price used for calculating COGS.</p>
                </div>
                <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-medium border border-amber-200">
                    Feature Active
                </span>
            </div>

            <div className="p-6 space-y-6">
                <div className="flex items-end gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Current Gold Price (per gram)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-xs">
                                {currentAccount?.goldPriceCurrency || currentAccount?.currency || 'USD'}
                            </span>
                            <input
                                type="number"
                                step="0.01"
                                value={priceInput}
                                onChange={e => setPriceInput(e.target.value)}
                                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 outline-none"
                            />
                        </div>
                    </div>

                    <button
                        onClick={handleSaveManual}
                        disabled={isLoading}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-50"
                    >
                        Save Manual
                    </button>

                    <div className="w-px h-10 bg-gray-300 mx-2"></div>

                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white font-medium rounded-md hover:bg-amber-700"
                    >
                        <RefreshCw size={18} className={isLoading ? "animate-spin" : ""} />
                        Refresh from Market
                    </button>
                </div>

                <div className="text-sm text-gray-500 flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 text-amber-500 shrink-0" />
                    <p>
                        This price will be applied to all products marked "Gold Price Required".
                        The formula is: <strong>Price * Product Weight</strong>.
                    </p>
                </div>
            </div>
        </div>
    );
}
