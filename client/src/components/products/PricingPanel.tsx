import React from 'react';
import { DollarSign } from 'lucide-react';

interface PricingPanelProps {
    formData: any;
    onChange?: (updates: any) => void;
}

export const PricingPanel: React.FC<PricingPanelProps> = ({ formData, onChange }) => {
    return (
        <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-sm border border-white/50 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                <DollarSign size={16} className="text-blue-600" />
                Pricing
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Regular Price</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                            type="number"
                            step="0.01"
                            value={formData.price}
                            onChange={(e) => onChange && onChange({ price: e.target.value })}
                            className="w-full pl-8 pr-4 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
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
                            className="w-full pl-8 pr-4 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
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
                            className="w-full pl-8 pr-4 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                            placeholder="0.00"
                        />
                    </div>
                </div>
            </div>

            {/* Profit Margin Info could go here if we had COGS */}
        </div>
    );
};
