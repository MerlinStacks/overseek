import { useState } from 'react';
import { reportMoney } from '../../analytics/useReportRequest';
import { validBOMValues } from './bomValues';

export interface BOMItem {
    id?: string; childProductId?: string; childVariationId?: number; internalProductId?: string; supplierItemId?: string;
    displayName: string; quantity: number; wasteFactor: number; cost: number; isInternal?: boolean;
}
export interface BOMItemsTableProps { items: BOMItem[]; selectedScope: number; onItemsChange: (items: BOMItem[]) => void; currency?: string; disabled?: boolean }
function NumericDraft({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
    const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : '');
    return <input aria-label={label} type="number" min="0" step="any" value={draft} aria-invalid={!Number.isFinite(value) || value < 0 || (label.startsWith('Quantity') && value === 0)} className="w-24 border rounded p-1 bg-white dark:bg-slate-900" onChange={event => { const text = event.target.value; setDraft(text); onChange(text.trim() ? Number(text) : NaN); }} />;
}
export function BOMItemsTable({ items, selectedScope, onItemsChange, currency, disabled = false }: BOMItemsTableProps) {
    const update = (index: number, field: 'quantity' | 'wasteFactor', value: number) => onItemsChange(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    return <fieldset disabled={disabled}><div className="overflow-x-auto"><table className="w-full text-slate-900 dark:text-slate-100"><thead><tr><th className="text-left p-3">Component</th><th>Qty</th><th>Waste %</th><th>Cost</th><th>Actions</th></tr></thead><tbody>
        {!items.length && <tr><td colSpan={5} className="p-4">No BOM items configured for this {selectedScope === 0 ? 'product' : 'variant'}.</td></tr>}
        {items.map((item, index) => <tr key={item.id || JSON.stringify([item.childProductId, item.childVariationId, item.internalProductId, item.supplierItemId])}>
            <td className="p-3">{item.displayName}</td>
            <td><NumericDraft value={item.quantity} label={`Quantity for ${item.displayName}`} onChange={value => update(index, 'quantity', value)} /></td>
            <td><NumericDraft value={item.wasteFactor * 100} label={`Waste percentage for ${item.displayName}`} onChange={value => update(index, 'wasteFactor', value / 100)} /></td>
            <td>{reportMoney(validBOMValues(item) && Number.isFinite(item.cost) && item.cost >= 0 ? item.quantity * item.cost * (1 + item.wasteFactor) : NaN, currency)}</td>
            <td><button type="button" aria-label={`Remove ${item.displayName}`} onClick={() => onItemsChange(items.filter((_, i) => i !== index))}>Remove</button></td>
        </tr>)}
    </tbody></table></div></fieldset>;
}
