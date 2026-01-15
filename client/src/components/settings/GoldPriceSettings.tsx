import { useState, useEffect } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { RefreshCw, AlertTriangle } from 'lucide-react';

export function GoldPriceSettings() {
    const { currentAccount, refreshAccounts } = useAccount();
    const isEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const [isLoading, setIsLoading] = useState(false);

    const [priceInput, setPriceInput] = useState(currentAccount?.goldPrice?.toString() || '0');
    const [marginInput, setMarginInput] = useState(currentAccount?.goldPriceMargin?.toString() || '10');
    const [price18ctInput, setPrice18ctInput] = useState(currentAccount?.goldPrice18ct?.toString() || '0');
    const [price9ctInput, setPrice9ctInput] = useState(currentAccount?.goldPrice9ct?.toString() || '0');
    const [price18ctWhiteInput, setPrice18ctWhiteInput] = useState(currentAccount?.goldPrice18ctWhite?.toString() || '0');
    const [price9ctWhiteInput, setPrice9ctWhiteInput] = useState(currentAccount?.goldPrice9ctWhite?.toString() || '0');

    // Sync input when account updates
    useEffect(() => {
        if (currentAccount) {
            if (currentAccount.goldPrice !== undefined) setPriceInput(currentAccount.goldPrice.toString());
            if (currentAccount.goldPriceMargin !== undefined) setMarginInput(currentAccount.goldPriceMargin.toString());
            if (currentAccount.goldPrice18ct !== undefined) setPrice18ctInput(currentAccount.goldPrice18ct.toString());
            if (currentAccount.goldPrice9ct !== undefined) setPrice9ctInput(currentAccount.goldPrice9ct.toString());
            if (currentAccount.goldPrice18ctWhite !== undefined) setPrice18ctWhiteInput(currentAccount.goldPrice18ctWhite.toString());
            if (currentAccount.goldPrice9ctWhite !== undefined) setPrice9ctWhiteInput(currentAccount.goldPrice9ctWhite.toString());
        }
    }, [currentAccount]);

    if (!isEnabled) return null;

    const handleRefresh = async () => {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ refreshGoldPrice: true })
            });
            if (res.ok) {
                await refreshAccounts(); // Update context, which triggers useEffect
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
                body: JSON.stringify({
                    goldPrice: priceInput,
                    goldPriceMargin: marginInput,
                    goldPrice18ct: price18ctInput,
                    goldPrice9ct: price9ctInput,
                    goldPrice18ctWhite: price18ctWhiteInput,
                    goldPrice9ctWhite: price9ctWhiteInput
                })
            });
            if (res.ok) {
                await refreshAccounts();
            }
        } finally {
            setIsLoading(false);
        }
    };

    const currency = currentAccount?.goldPriceCurrency || currentAccount?.currency || 'USD';

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-medium text-gray-900">Gold Price Configuration</h2>
                    <p className="text-sm text-gray-500 mt-1">Manage the gold prices and margin used for calculating COGS.</p>
                </div>
                <div className="flex items-center gap-3">
                     <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-medium border border-amber-200">
                        Feature Active
                    </span>
                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white font-medium rounded-md hover:bg-amber-700 disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={isLoading ? "animate-spin" : ""} />
                        Refresh from Market
                    </button>
                </div>
            </div>

            <div className="p-6 space-y-6">
                 {/* Margin Settings */}
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Margin (%)</label>
                    <p className="text-xs text-gray-500 mb-2">Added on top of the market gold price.</p>
                    <div className="flex gap-4 items-center">
                        <div className="relative w-32">
                            <input
                                type="number"
                                step="0.1"
                                value={marginInput}
                                onChange={e => setMarginInput(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 outline-hidden"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
                        </div>
                         <button
                            onClick={handleSaveManual}
                            disabled={isLoading}
                            className="text-sm text-amber-700 hover:text-amber-800 font-medium"
                        >
                            Save Margin & Update
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Yellow Gold */}
                    <div className="space-y-4">
                        <h3 className="font-medium text-gray-900 border-b pb-2">Yellow Gold</h3>

                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">18ct Gold Price (per gram)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-xs">{currency}</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={price18ctInput}
                                    onChange={e => setPrice18ctInput(e.target.value)}
                                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 outline-hidden"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">9ct Gold Price (per gram)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-xs">{currency}</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={price9ctInput}
                                    onChange={e => setPrice9ctInput(e.target.value)}
                                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 outline-hidden"
                                />
                            </div>
                        </div>
                    </div>

                    {/* White Gold */}
                    <div className="space-y-4">
                        <h3 className="font-medium text-gray-900 border-b pb-2">White Gold</h3>
                         <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">18ct White Gold Price (per gram)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-xs">{currency}</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={price18ctWhiteInput}
                                    onChange={e => setPrice18ctWhiteInput(e.target.value)}
                                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 outline-hidden"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">9ct White Gold Price (per gram)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-xs">{currency}</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={price9ctWhiteInput}
                                    onChange={e => setPrice9ctWhiteInput(e.target.value)}
                                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 outline-hidden"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-gray-200">
                     <button
                        onClick={handleSaveManual}
                        disabled={isLoading}
                        className="px-4 py-2 bg-indigo-600 text-white font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    >
                        Save All Prices
                    </button>
                </div>

                <div className="text-sm text-gray-500 flex items-start gap-2 bg-gray-50 p-3 rounded-md">
                    <AlertTriangle size={16} className="mt-0.5 text-amber-500 shrink-0" />
                    <p>
                        These prices will be applied to products based on their selected Gold Type.
                        Formula: <strong>Settings Price * Product Weight</strong>.
                        "Refresh from Market" will update all prices based on current spot price + margin.
                    </p>
                </div>
            </div>
        </div>
    );
}
