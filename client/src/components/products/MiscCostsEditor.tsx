import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { reportMoney } from '../analytics/useReportRequest';

export interface MiscCost {
    amount: number;
    note: string;
}

interface MiscCostsEditorProps {
    value: MiscCost[];
    onChange: (costs: MiscCost[]) => void;
    currency?: string;
}

export const MiscCostsEditor: React.FC<MiscCostsEditorProps> = ({ value = [], onChange, currency }) => {
    const handleAdd = () => {
        onChange([...value, { amount: 0, note: '' }]);
    };

    const handleRemove = (index: number) => {
        const newValue = [...value];
        newValue.splice(index, 1);
        onChange(newValue);
    };

    const handleChange = (index: number, field: keyof MiscCost, val: string | number) => {
        const newValue = [...value];
        newValue[index] = { ...newValue[index], [field]: val };
        onChange(newValue);
    };

    const total = value.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);

    return (
        <div className="space-y-3">
            <div className="flex justify-between items-center">
                <h4 className="block text-sm font-medium text-gray-700">Miscellaneous Costs</h4>
                <span className="text-sm font-bold text-gray-500 dark:text-slate-400">Total: {currency === undefined ? `$${total.toFixed(2)}` : reportMoney(total, currency)}</span>
            </div>

            <div className="space-y-2">
                {value.map((item, index) => (
                    <div key={index} className="flex gap-2 items-center">
                         <div className="relative flex-1">
                            <input
                                aria-label={`Cost ${index + 1} description`}
                                type="text"
                                value={item.note}
                                onChange={(e) => handleChange(index, 'note', e.target.value)}
                                className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[var(--focus-color)] focus:border-[var(--primary-color)] outline-none transition-all"
                                placeholder="Description (e.g. Shipping)"
                            />
                        </div>
                        <div className="relative w-24">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{currency === undefined ? '$' : currency || '—'}</span>
                            <input
                                aria-label={`Cost ${index + 1} amount`}
                                type="number"
                                step="0.01"
                                value={Number.isFinite(item.amount) ? item.amount : ''}
                                onChange={(e) => {
                                    const amount = e.target.value === '' ? 0 : e.target.valueAsNumber;
                                    if (Number.isFinite(amount)) handleChange(index, 'amount', amount);
                                }}
                                className="w-full text-sm pl-10 pr-2 py-1.5 border border-gray-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-[var(--focus-color)] focus:border-[var(--primary-color)] outline-none transition-all"
                                placeholder="0.00"
                            />
                        </div>
                        <button
                            type="button" aria-label={`Remove cost ${index + 1}`}
                            onClick={() => handleRemove(index)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={handleAdd}
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--brand-text)] hover:text-[var(--brand-text)] px-2 py-1 hover:bg-[var(--brand-subtle)] rounded-md transition-colors"
            >
                <Plus size={14} />
                Add Cost
            </button>
        </div>
    );
};
