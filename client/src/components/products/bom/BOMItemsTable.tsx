/**
 * BOMItemsTable - Renders the BOM items list with quantity and waste inputs.
 * Extracted from BOMPanel.tsx for modularity.
 */
import React from 'react';
import { Trash2 } from 'lucide-react';

export interface BOMItem {
    id?: string;
    childProductId?: string;
    childVariationId?: number;
    internalProductId?: string;
    supplierItemId?: string;
    displayName: string;
    quantity: number;
    wasteFactor: number;
    cost: number;
    isInternal?: boolean;
}

export interface BOMItemsTableProps {
    items: BOMItem[];
    selectedScope: number;
    onItemsChange: (items: BOMItem[]) => void;
}

/**
 * Renders the BOM items table with editable quantity and waste factor columns.
 */
export function BOMItemsTable({ items, selectedScope, onItemsChange }: BOMItemsTableProps) {
    const handleQuantityChange = (idx: number, value: number) => {
        const newItems = [...items];
        newItems[idx].quantity = value;
        onItemsChange(newItems);
    };

    const handleWasteChange = (idx: number, value: number) => {
        const newItems = [...items];
        newItems[idx].wasteFactor = value;
        onItemsChange(newItems);
    };

    const handleDelete = (idx: number) => {
        onItemsChange(items.filter((_, i) => i !== idx));
    };

    return (
        <table className="w-full">
            <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase">
                <tr>
                    <th className="p-3 text-left">Component</th>
                    <th className="p-3 w-24">Qty</th>
                    <th className="p-3 w-24">Waste %</th>
                    <th className="p-3 text-right">Cost</th>
                    <th className="p-3 w-10"></th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
                {items.length === 0 ? (
                    <tr>
                        <td colSpan={5} className="p-6 text-center text-sm text-gray-400">
                            No BOM items configured for this {selectedScope === 0 ? 'product' : 'variant'}.
                        </td>
                    </tr>
                ) : (
                    items.map((item, idx) => (
                        <tr key={idx}>
                            <td className="p-3">
                                <div className="font-medium text-sm">{item.displayName}</div>
                            </td>
                            <td className="p-3">
                                <input
                                    type="number" min="0" step="any"
                                    value={item.quantity}
                                    onChange={e => handleQuantityChange(idx, Number(e.target.value))}
                                    className="w-full border rounded-sm p-1 text-center text-sm"
                                />
                            </td>
                            <td className="p-3">
                                <input
                                    type="number" min="0" step="0.01"
                                    value={item.wasteFactor}
                                    onChange={e => handleWasteChange(idx, Number(e.target.value))}
                                    className="w-full border rounded-sm p-1 text-center text-sm"
                                />
                            </td>
                            <td className="p-3 text-right text-sm">
                                ${(Number(item.quantity) * Number(item.cost) * (1 + Number(item.wasteFactor))).toFixed(2)}
                            </td>
                            <td className="p-3">
                                <button
                                    onClick={() => handleDelete(idx)}
                                    className="text-gray-400 hover:text-red-500"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    );
}
