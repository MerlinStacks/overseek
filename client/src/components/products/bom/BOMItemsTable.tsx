import { useState } from 'react';
import { reportMoney } from '../../analytics/useReportRequest';
import { validBOMValues } from './bomValues';
import { workspaceStyles as ui } from '../../ui/workspaceStyles';
import { cn } from '../../../utils/cn';

export interface BOMItem {
    id?: string; childProductId?: string; childVariationId?: number; internalProductId?: string; supplierItemId?: string;
    displayName: string; quantity: number; wasteFactor: number; cost: number; isInternal?: boolean;
}
export interface BOMItemsTableProps { items: BOMItem[]; selectedScope: number; onItemsChange: (items: BOMItem[]) => void; currency?: string; disabled?: boolean }
function NumericDraft({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
    const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : '');
    return <input aria-label={label} type="number" min="0" step="any" value={draft} aria-invalid={!Number.isFinite(value) || value < 0 || (label.startsWith('Quantity') && value === 0)} className={cn(ui.input, 'w-24 px-2 py-1.5 aria-invalid:border-red-400')} onChange={event => { const text = event.target.value; setDraft(text); onChange(text.trim() ? Number(text) : NaN); }} />;
}
export function BOMItemsTable({ items, selectedScope, onItemsChange, currency, disabled = false }: BOMItemsTableProps) {
    const update = (index: number, field: 'quantity' | 'wasteFactor', value: number) => onItemsChange(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    return <fieldset disabled={disabled}><div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><table className={`${ui.table} text-slate-900 dark:text-slate-100`}><thead className={ui.tableHead}><tr>{['Component', 'Qty', 'Waste %', 'Cost', 'Actions'].map(label => <th scope="col" className={`${ui.cell} font-medium`} key={label}>{label}</th>)}</tr></thead><tbody className={ui.tableBody}>
        {!items.length && <tr><td colSpan={5} className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No BOM items configured for this {selectedScope === 0 ? 'product' : 'variant'}.</td></tr>}
        {items.map((item, index) => <tr key={item.id || JSON.stringify([item.childProductId, item.childVariationId, item.internalProductId, item.supplierItemId])}>
            <td className={`${ui.cell} min-w-40 font-medium`}>{item.displayName}</td>
            <td className={ui.cell}><NumericDraft value={item.quantity} label={`Quantity for ${item.displayName}`} onChange={value => update(index, 'quantity', value)} /></td>
            <td className={ui.cell}><NumericDraft value={item.wasteFactor * 100} label={`Waste percentage for ${item.displayName}`} onChange={value => update(index, 'wasteFactor', value / 100)} /></td>
            <td className={`${ui.cell} whitespace-nowrap tabular-nums`}>{reportMoney(validBOMValues(item) && Number.isFinite(item.cost) && item.cost >= 0 ? item.quantity * item.cost * (1 + item.wasteFactor) : NaN, currency)}</td>
            <td className={ui.cell}><button className={`${ui.danger} py-1.5 text-xs`} type="button" aria-label={`Remove ${item.displayName}`} onClick={() => onItemsChange(items.filter((_, i) => i !== index))}>Remove</button></td>
        </tr>)}
    </tbody></table></div></fieldset>;
}
