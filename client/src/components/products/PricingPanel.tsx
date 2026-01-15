import * as React from 'react';
import { DollarSign } from 'lucide-react';
import { MiscCostsEditor, MiscCost } from './MiscCostsEditor';

interface PricingPanelProps {
    formData: any;
    onChange?: (updates: any) => void;
}

export const PricingPanel: React.FC<PricingPanelProps> = ({ formData, onChange }) => {
    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                <DollarSign size={16} className="text-blue-600" />
                Pricing
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Regular Price</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.price}
                            onChange={(e) => onChange && onChange({ price: e.target.value })}
                            className="w-full pl-8 pr-4 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            placeholder="0.00"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sale Price</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.salePrice}
                            onChange={(e) => onChange && onChange({ salePrice: e.target.value })}
                            className="w-full pl-8 pr-4 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            placeholder="0.00"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cost of Goods (COGS)</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.cogs}
                            onChange={(e) => onChange && onChange({ cogs: e.target.value })}
                            className="w-full pl-8 pr-4 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                            placeholder="0.00"
                        />
                    </div>
                </div>
            </div>

            <div className="mb-6">
                <MiscCostsEditor
                    value={formData.miscCosts || []}
                    onChange={(costs) => onChange && onChange({ miscCosts: costs })}
                />
            </div>

            {/* Profit Margin Calculator */}
            {(() => {
                const sellingPrice = parseFloat(formData.salePrice) || parseFloat(formData.price) || 0;
                const cogs = parseFloat(formData.cogs) || 0;
                const miscTotal = (formData.miscCosts || []).reduce((sum: number, item: MiscCost) => sum + (Number(item.amount) || 0), 0);
                const totalCost = cogs + miscTotal;

                const profitDollar = sellingPrice - totalCost;
                const profitPercent = sellingPrice > 0 ? ((profitDollar / sellingPrice) * 100) : 0;
                const hasCogs = (formData.cogs && parseFloat(formData.cogs) > 0) || miscTotal > 0;
                const hasPrice = sellingPrice > 0;

                if (!hasPrice && !hasCogs) return null;

                return (
                    <div className="mt-6 pt-6 border-t border-gray-100/50">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700">Profit Margin</span>
                            {hasCogs && hasPrice ? (
                                <div className="flex items-center gap-3">
                                    <span className={`text-lg font-bold ${profitDollar >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        ${profitDollar.toFixed(2)}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${profitPercent >= 0
                                        ? 'bg-green-50 text-green-700 border border-green-200'
                                        : 'bg-red-50 text-red-700 border border-red-200'
                                        }`}>
                                        {profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%
                                    </span>
                                </div>
                            ) : (
                                <span className="text-sm text-gray-400 italic">
                                    {!hasCogs ? 'Enter COGS to calculate' : 'Enter price to calculate'}
                                </span>
                            )}
                        </div>
                        {hasCogs && hasPrice && (
                            <p className="text-xs text-gray-500 mt-1">
                                Based on {formData.salePrice && parseFloat(formData.salePrice) > 0 ? 'sale' : 'regular'} price of ${sellingPrice.toFixed(2)}
                            </p>
                        )}
                    </div>
                );
            })()}
        </div>
    );
};
