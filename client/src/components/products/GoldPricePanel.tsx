import { useState } from 'react';
import { useAccountFeature } from '../../hooks/useAccountFeature';
import { useAccount } from '../../context/AccountContext';
import { AlertTriangle, Scale, DollarSign, Calculator } from 'lucide-react';

interface GoldPricePanelProps {
    product: any;
    onChange: (updates: any) => void;
}

export function GoldPricePanel({ product, onChange }: GoldPricePanelProps) {
    const isEnabled = useAccountFeature('GOLD_PRICE_CALCULATOR');
    const { currentAccount } = useAccount();

    if (!isEnabled) return null;

    const weight = product.weight ? parseFloat(product.weight) : 0;

    // Determine current selection
    // If goldPriceType is set, use it.
    // If not, but isGoldPriceApplied is true, treat as "Legacy/Base"
    const currentType = product.goldPriceType || (product.isGoldPriceApplied ? 'legacy' : 'none');

    // Get price based on type
    const getPrice = (type: string) => {
        switch (type) {
            case '18ct': return Number(currentAccount?.goldPrice18ct) || 0;
            case '9ct': return Number(currentAccount?.goldPrice9ct) || 0;
            case '18ctWhite': return Number(currentAccount?.goldPrice18ctWhite) || 0;
            case '9ctWhite': return Number(currentAccount?.goldPrice9ctWhite) || 0;
            case 'legacy': return Number(currentAccount?.goldPrice) || 0;
            default: return 0;
        }
    };

    const selectedPrice = getPrice(currentType);
    const calculatedCost = weight * selectedPrice;

    const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newType = e.target.value;
        if (newType === 'none') {
            onChange({ isGoldPriceApplied: false, goldPriceType: null });
        } else if (newType === 'legacy') {
             onChange({ isGoldPriceApplied: true, goldPriceType: null });
        } else {
            onChange({ isGoldPriceApplied: true, goldPriceType: newType });
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-amber-50/30">
                <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                    <DollarSign className="text-amber-600" size={20} /> Gold Price Calculation
                </h2>

                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">Gold Type:</label>
                    <select
                        value={currentType}
                        onChange={handleTypeChange}
                        className="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-hidden focus:ring-amber-500 focus:border-amber-500 sm:text-sm rounded-md bg-white"
                    >
                        <option value="none">None</option>
                        <option value="18ct">18ct Gold</option>
                        <option value="9ct">9ct Gold</option>
                        <option value="18ctWhite">18ct White Gold</option>
                        <option value="9ctWhite">9ct White Gold</option>
                        {currentType === 'legacy' && <option value="legacy">Legacy (Base Price)</option>}
                    </select>
                </div>
            </div>

            <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="text-xs text-gray-500 uppercase font-bold mb-1">Applied Price</div>
                        <div className="text-xl font-mono text-gray-900">
                             ${selectedPrice.toFixed(2)} <span className="text-sm text-gray-500">/g</span>
                        </div>
                         {currentType !== 'none' && (
                            <div className="text-xs text-gray-500 mt-1">
                                Based on {currentType === 'legacy' ? 'Base Price' : currentType} setting
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="text-xs text-gray-500 uppercase font-bold mb-1">Product Weight</div>
                        <div className="flex items-center gap-2">
                            <Scale size={16} className="text-gray-400" />
                            <div className="text-xl font-mono text-gray-900">{weight > 0 ? weight : '--'} g</div>
                        </div>
                        {!weight && <p className="text-xs text-red-500 mt-1">Missing weight from sync</p>}
                    </div>

                    <div className={`p-4 border rounded-lg ${currentType !== 'none' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200 opacity-50'}`}>
                        <div className="text-xs text-gray-500 uppercase font-bold mb-1">Calculated COGS</div>
                        <div className="flex items-center gap-2">
                            <Calculator size={16} className="text-gray-400" />
                            <div className="text-xl font-mono text-gray-900">
                                ${calculatedCost.toFixed(2)}
                            </div>
                        </div>
                    </div>
                </div>

                {currentType !== 'none' && (
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
