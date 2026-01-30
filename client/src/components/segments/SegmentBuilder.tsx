
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, X } from 'lucide-react';

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

        // Reset operator if field changes and type mismatch
        if (updates.field) {
            const fieldType = FIELDS.find(f => f.value === updates.field)?.type;
            const currentOp = newRules[index].operator;
            // Basic check, could be smarter
            if (fieldType === 'number' && ['contains', 'startsWith'].includes(currentOp)) {
                newRules[index].operator = 'gt';
            }
            if (fieldType === 'text' && ['gt', 'lt'].includes(currentOp)) {
                newRules[index].operator = 'contains';
            }
        }

        setCriteria({ ...criteria, rules: newRules });
    };

    const removeRule = (index: number) => {
        const newRules = criteria.rules.filter((_, i) => i !== index);
        setCriteria({ ...criteria, rules: newRules });
    };

    const getOperators = (fieldValue: string) => {
        const type = FIELDS.find(f => f.value === fieldValue)?.type || 'text';
        return OPERATORS[type as keyof typeof OPERATORS];
    };

    return (
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-xs space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Segment Rules</h3>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Match</span>
                    <select
                        className="bg-gray-50 border border-gray-300 rounded-sm px-2 py-1 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
                    <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 group">
                        <select
                            className="flex-1 bg-white border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={rule.field}
                            onChange={(e) => updateRule(index, { field: e.target.value })}
                        >
                            {FIELDS.map(f => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                        </select>

                        <select
                            className="w-40 bg-white border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            value={rule.operator}
                            onChange={(e) => updateRule(index, { operator: e.target.value })}
                        >
                            {getOperators(rule.field).map(op => (
                                <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                        </select>

                        <input
                            type="text"
                            className="flex-1 bg-white border border-gray-300 rounded-sm px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="Value"
                            value={rule.value}
                            onChange={(e) => updateRule(index, { value: e.target.value })}
                        />

                        <button
                            onClick={() => removeRule(index)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-sm transition-colors"
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
                    className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium px-2 py-1 rounded-sm hover:bg-blue-50 transition-colors"
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
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                    {isSaving ? <span className="animate-spin">⌛</span> : <Save size={16} />}
                    Save Segment
                </button>
            </div>
        </div>
    );
}
