
import { useState } from 'react';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { getSegmentFieldType } from '../../utils/conditionFieldRules';
import { PurchaseTargetPicker } from './PurchaseTargetPicker';

export interface SegmentRule {
    field: string;
    operator: string;
    value: string;
    campaignId?: string;
    withinDays?: string;
    valueLabel?: string;
}

export interface SegmentCriteria {
    type: 'AND' | 'OR';
    rules: SegmentRule[];
}

interface SegmentBuilderProps {
    initialCriteria?: SegmentCriteria;
    onSave: (criteria: SegmentCriteria) => void;
    onCancel: () => void;
    isSaving?: boolean;
}

const FIELDS = [
    { label: 'Purchased a product', value: 'purchasedProduct', type: 'purchase' },
    { label: 'Purchased from a category', value: 'purchasedCategory', type: 'purchase' },
    { label: 'Opened email in the last (days)', value: 'emailOpenedWithinDays', type: 'number' },
    { label: 'Clicked email in the last (days)', value: 'emailClickedWithinDays', type: 'number' },
    { label: 'No email opens in the last (days)', value: 'notEmailOpenedWithinDays', type: 'number' },
    { label: 'No email clicks in the last (days)', value: 'notEmailClickedWithinDays', type: 'number' },
    { label: 'Purchased in the last (days)', value: 'purchasedWithinDays', type: 'number' },
    { label: 'No purchase in the last (days)', value: 'notPurchasedWithinDays', type: 'number' },
    { label: 'Abandoned cart in the last (days)', value: 'abandonedCartWithinDays', type: 'number' },
    { label: 'Total Spent', value: 'totalSpent', type: 'number' },
    { label: 'Orders Count', value: 'ordersCount', type: 'number' },
    { label: 'Email', value: 'email', type: 'text' },
    { label: 'First Name', value: 'firstName', type: 'text' },
    { label: 'Last Name', value: 'lastName', type: 'text' }
];

const ENGAGEMENT_FIELDS = new Set(['emailOpenedWithinDays', 'emailClickedWithinDays', 'notEmailOpenedWithinDays', 'notEmailClickedWithinDays']);
const PURCHASE_FIELDS = new Set(['purchasedProduct', 'purchasedCategory']);
const ROLLING_FIELDS = new Set(['purchasedWithinDays', 'notPurchasedWithinDays', 'abandonedCartWithinDays', ...ENGAGEMENT_FIELDS]);
const PRESETS: { name: string; rules: SegmentRule[] }[] = [
    { name: 'Email clickers, no purchase', rules: [{ field: 'emailClickedWithinDays', operator: 'within', value: '30' }, { field: 'notPurchasedWithinDays', operator: 'within', value: '30' }] },
    { name: 'Inactive email audience', rules: [{ field: 'notEmailClickedWithinDays', operator: 'within', value: '90' }] },
    { name: 'Recent purchasers', rules: [{ field: 'purchasedWithinDays', operator: 'within', value: '30' }] },
    { name: 'Abandoned carts', rules: [{ field: 'abandonedCartWithinDays', operator: 'within', value: '7' }] },
    { name: 'Win-back customers', rules: [{ field: 'ordersCount', operator: 'gte', value: '1' }, { field: 'notPurchasedWithinDays', operator: 'within', value: '90' }] },
    { name: 'Repeat customers', rules: [{ field: 'ordersCount', operator: 'gte', value: '2' }] },
    { name: 'High-value customers', rules: [{ field: 'totalSpent', operator: 'gte', value: '500' }] }
];

const OPERATORS = {
    number: [
        { label: 'Greater Than', value: 'gt' },
        { label: 'Less Than', value: 'lt' },
        { label: 'Equals', value: 'eq' },
        { label: 'Greater or Equal', value: 'gte' },
        { label: 'Less or Equal', value: 'lte' }
    ],
    text: [
        { label: 'Contains', value: 'contains' },
        { label: 'Equals', value: 'equals' },
        { label: 'Starts With', value: 'startsWith' }
    ]
};

export function SegmentBuilder({ initialCriteria, onSave, onCancel, isSaving }: SegmentBuilderProps) {
    const [criteria, setCriteria] = useState<SegmentCriteria>(initialCriteria || { type: 'AND', rules: [] });

    const addRule = () => {
        setCriteria({
            ...criteria,
            rules: [...criteria.rules, { field: 'totalSpent', operator: 'gt', value: '' }]
        });
    };

    const updateRule = (index: number, updates: Partial<SegmentRule>) => {
        const newRules = [...criteria.rules];
        newRules[index] = { ...newRules[index], ...updates };

        if (updates.field) {
            const allowedOperators = getOperators(updates.field).map((operator) => operator.value);
            if (!allowedOperators.includes(newRules[index].operator)) {
                newRules[index].operator = allowedOperators[0] || '';
            }
            newRules[index].value = '';
            delete newRules[index].campaignId;
            delete newRules[index].withinDays;
            delete newRules[index].valueLabel;
        }

        setCriteria({ ...criteria, rules: newRules });
    };

    const removeRule = (index: number) => {
        const newRules = criteria.rules.filter((_, i) => i !== index);
        setCriteria({ ...criteria, rules: newRules });
    };

    const getOperators = (fieldValue: string) => {
        if (PURCHASE_FIELDS.has(fieldValue)) return [{ label: 'Has purchased', value: 'purchased' }, { label: 'Has not purchased', value: 'notPurchased' }];
        if (ROLLING_FIELDS.has(fieldValue)) return [{ label: 'Rolling window', value: 'within' }];
        const type = getSegmentFieldType(fieldValue);
        return OPERATORS[type as keyof typeof OPERATORS];
    };

    const isValid = criteria.rules.every(rule => {
        if (PURCHASE_FIELDS.has(rule.field)) return /^\d+$/.test(rule.value) && Number(rule.value) > 0 && (rule.withinDays === undefined || (/^\d+$/.test(rule.withinDays) && Number(rule.withinDays) >= 1 && Number(rule.withinDays) <= 3650));
        if (ROLLING_FIELDS.has(rule.field)) return Number.isInteger(Number(rule.value)) && Number(rule.value) >= 1 && Number(rule.value) <= 3650;
        if (getSegmentFieldType(rule.field) === 'number') return rule.value.trim() !== '' && Number.isFinite(Number(rule.value)) && Number(rule.value) >= 0;
        return rule.value.trim().length > 0;
    });

    return (
        <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-4 shadow-xs sm:p-6 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100">Segment Rules</h3>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-500">Match</span>
                    <select
                        aria-label="Match conditions"
                        className="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
                        value={criteria.type}
                        onChange={(e) => setCriteria({ ...criteria, type: e.target.value as 'AND' | 'OR' })}
                    >
                        <option value="AND">All (AND)</option>
                        <option value="OR">Any (OR)</option>
                    </select>
                    <span className="text-sm text-gray-500">of the following conditions:</span>
                </div>
            </div>

            <div className="space-y-3 border-b border-gray-100 pb-4 text-sm dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-medium text-gray-500">Quick start</span>
                    {PRESETS.map(preset => <button key={preset.name} type="button" onClick={() => setCriteria({ type: 'AND', rules: preset.rules.map(rule => ({ ...rule })) })} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-600 dark:text-slate-300 dark:hover:text-indigo-300">{preset.name}</button>)}
                </div>
                <details className="text-xs leading-5 text-gray-500 dark:text-slate-400">
                <summary className="w-fit cursor-pointer font-medium hover:text-indigo-600">How audience rules work</summary>
                <p className="mt-3">Presets replace the current rules. Day windows roll forward automatically. Purchases include processing/completed orders. Abandoned carts require 30 minutes of inactivity and exclude later purchases.</p>
                <p className="mt-2">Customer previews and email broadcasts include known customers. Advertising sync can optionally include subscribed list members without customer records. Anonymous visitors cannot be exported. Add an orders-count condition when excluding recent purchases to target past customers only.</p>
                <p className="mt-2">Email rules use tracked opens/clicks, which may include privacy proxies and automated scanners. “No clicks/opens” also matches people with no tracked email history. Prefer clicks for engagement audiences.</p>
                <p className="mt-2">Product rules include all variations of the selected product. Category rules use current synced product categories, not historical category assignments. A blank purchase window means all time. “Has not purchased” also includes customers who have never ordered; add an orders-count condition to target past customers only.</p>
                </details>
            </div>

            <div className="space-y-4">
                {criteria.rules.map((rule, index) => (
                    <div key={index} className="grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto] sm:items-start dark:border-slate-700 dark:bg-slate-900/50">
                        <select
                            aria-label={`Condition ${index + 1} field`}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                            value={rule.field}
                            onChange={(e) => updateRule(index, { field: e.target.value })}
                        >
                            {FIELDS.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                        </select>

                        <select
                            aria-label={`Condition ${index + 1} operator`}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                            value={rule.operator}
                            onChange={(e) => updateRule(index, { operator: e.target.value })}
                        >
                            {getOperators(rule.field).map(op => (
                                <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                        </select>

                        {PURCHASE_FIELDS.has(rule.field) ? <PurchaseTargetPicker key={rule.field} kind={rule.field === 'purchasedProduct' ? 'product' : 'category'} value={rule.value} label={rule.valueLabel} onChange={(value, valueLabel) => updateRule(index, { value, valueLabel })} /> : <input
                            aria-label={`Condition ${index + 1} value`}
                            type={getSegmentFieldType(rule.field) === 'number' ? 'number' : 'text'}
                            inputMode={getSegmentFieldType(rule.field) === 'number' ? 'decimal' : 'text'}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                            placeholder="Value"
                            min={ROLLING_FIELDS.has(rule.field) ? 1 : 0}
                            max={ROLLING_FIELDS.has(rule.field) ? 3650 : undefined}
                            step={ROLLING_FIELDS.has(rule.field) ? 1 : 'any'}
                            value={rule.value}
                            onChange={(e) => updateRule(index, { value: e.target.value })}
                        />}

                        <button
                            onClick={() => removeRule(index)}
                            type="button"
                            title="Remove condition"
                            className="justify-self-end rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                            <Trash2 size={16} />
                        </button>
                        {PURCHASE_FIELDS.has(rule.field) && <label className="flex flex-wrap items-center gap-2 text-xs text-gray-500 sm:col-span-4 dark:text-slate-400">
                            Purchased within the last
                            <input aria-label={`Condition ${index + 1} purchase window`} type="number" min={1} max={3650} step={1} placeholder="All time" value={rule.withinDays || ''} onChange={event => updateRule(index, { withinDays: event.target.value || undefined })} className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
                            days (optional)
                        </label>}
                        {ENGAGEMENT_FIELDS.has(rule.field) && <label className="text-xs text-gray-600 sm:col-span-4 dark:text-slate-300">
                            Optional campaign / automation ID (blank = all tracked emails)
                            <input aria-label="Email source ID" className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:bg-slate-800" value={rule.campaignId || ''} maxLength={200} onChange={event => updateRule(index, { campaignId: event.target.value.trim() || undefined })} />
                        </label>}
                    </div>
                ))}

                {criteria.rules.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                        No conditions yet. Add a condition or choose a quick start above.
                        <p className="mt-1 text-xs">Without conditions, this segment includes all customers.</p>
                    </div>
                )}

                <button
                    onClick={addRule}
                    type="button"
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                >
                    <Plus size={16} />
                    Add Condition
                </button>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-700">
                <button
                    onClick={onCancel}
                    type="button"
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors dark:text-slate-300 dark:hover:bg-slate-700"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={() => onSave(criteria)}
                    disabled={isSaving || !isValid}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Segment
                </button>
            </div>
        </div>
    );
}
