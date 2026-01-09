import { useState } from 'react';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useAccount } from '../../context/AccountContext';
import { AlertTriangle, Scale, DollarSign, Calculator } from 'lucide-react';

interface GoldPricePanelProps {
    product: any;
    // We pass onChange to update local state like other panels
    onChange: (updates: any) => void;
}

export function GoldPricePanel({ product, onChange }: GoldPricePanelProps) {
    const isEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const { currentAccount } = useAccount();

    if (!isEnabled) return null;

    const goldPrice = Number(currentAccount?.goldPrice) || 0;
    const weight = product.weight ? parseFloat(product.weight) : 0;
    const isApplied = product.isGoldPriceApplied || false;

    // Calculate COGS preview
    const calculatedCost = weight * goldPrice;

    const toggleApplied = () => {
        onChange({ isGoldPriceApplied: !isApplied });
    };

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-amber-50/30">
                <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                    <DollarSign className="text-amber-600" size={20} /> Gold Price Calculation
                </h2>

                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={isApplied}
                        onChange={toggleApplied}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-hidden peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
            </div>

            <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="text-xs text-gray-500 uppercase font-bold mb-1">Live Gold Price</div>
                        <div className="text-xl font-mono text-gray-900">${goldPrice.toFixed(2)} /g</div>
                    </div>

                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="text-xs text-gray-500 uppercase font-bold mb-1">Product Weight</div>
                        <div className="flex items-center gap-2">
                            <Scale size={16} className="text-gray-400" />
                            <div className="text-xl font-mono text-gray-900">{weight > 0 ? weight : '--'} g</div>
                        </div>
                        {!weight && <p className="text-xs text-red-500 mt-1">Missing weight from sync</p>}
                    </div>

                    <div className={`p-4 border rounded-lg ${isApplied ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200 opacity-50'}`}>
                        <div className="text-xs text-gray-500 uppercase font-bold mb-1">Calculated COGS</div>
                        <div className="flex items-center gap-2">
                            <Calculator size={16} className="text-gray-400" />
                            <div className="text-xl font-mono text-gray-900">
                                ${calculatedCost.toFixed(2)}
                            </div>
                        </div>
                    </div>
                </div>

                {isApplied && (
                    <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 p-3 rounded-md border border-amber-100">
                        <AlertTriangle size={16} className="mt-0.5" />
                        <p>
                            This calculated cost (${calculatedCost.toFixed(2)}) will override any manual COGS or BOM cost for margin reports.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
