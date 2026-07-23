
import { useState } from 'react';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { getSegmentFieldType } from '../../utils/conditionFieldRules';

export interface SegmentRule {
    field: string;
    operator: string;
    value: string;
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
    { label: 'Total Spent', value: 'totalSpent', type: 'number' },
    { label: 'Orders Count', value: 'ordersCount', type: 'number' },
    { label: 'Email', value: 'email', type: 'text' },
    { label: 'First Name', value: 'firstName', type: 'text' },
    { label: 'Last Name', value: 'lastName', type: 'text' }
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
        }

        setCriteria({ ...criteria, rules: newRules });
    };

    const removeRule = (index: number) => {
        const newRules = criteria.rules.filter((_, i) => i !== index);
        setCriteria({ ...criteria, rules: newRules });
    };

    const getOperators = (fieldValue: string) => {
        const type = getSegmentFieldType(fieldValue);
        return OPERATORS[type as keyof typeof OPERATORS];
    };

    return (
        <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-4 shadow-xs sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-medium text-gray-900">Segment Rules</h3>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-500">Match</span>
                    <select
                        className="rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        value={criteria.type}
                        onChange={(e) => setCriteria({ ...criteria, type: e.target.value as 'AND' | 'OR' })}
                    >
                        <option value="AND">All (AND)</option>
                        <option value="OR">Any (OR)</option>
                    </select>
                    <span className="text-sm text-gray-500">of the following conditions:</span>
                </div>
            </div>

            <div className="space-y-4">
                {criteria.rules.map((rule, index) => (
                    <div key={index} className="grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto] sm:items-center">
                        <select
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                            value={rule.field}
                            onChange={(e) => updateRule(index, { field: e.target.value })}
                        >
                            {FIELDS.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                        </select>

                        <select
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                            value={rule.operator}
                            onChange={(e) => updateRule(index, { operator: e.target.value })}
                        >
                            {getOperators(rule.field).map(op => (
                                <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                        </select>

                        <input
                            type={getSegmentFieldType(rule.field) === 'number' ? 'number' : 'text'}
                            inputMode={getSegmentFieldType(rule.field) === 'number' ? 'decimal' : 'text'}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                            placeholder="Value"
                            value={rule.value}
                            onChange={(e) => updateRule(index, { value: e.target.value })}
                        />

                        <button
                            onClick={() => removeRule(index)}
                            type="button"
                            title="Remove condition"
                            className="justify-self-end rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}

                {criteria.rules.length === 0 && (
                    <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                        No rules defined. This segment will match all customers.
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

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={() => onSave(criteria)}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                >
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Segment
                </button>
            </div>
        </div>
    );
}
