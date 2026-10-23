import { memo } from 'react';
import { type ProductVariant, getVariantImage, parseVariantStock } from './variantTypes';
import { ChevronDown, Package, Save } from 'lucide-react';
import { workspaceStyles as ui } from '../ui/workspaceStyles';
import { cn } from '../../utils/cn';

interface Props {
    variant: ProductVariant; isExpanded: boolean; onToggleExpand: () => void;
    onFieldChange: (field: keyof ProductVariant, value: ProductVariant[keyof ProductVariant]) => void;
    stockEditValue: string; onStockEditChange: (value: string) => void; onStockAdjust: (delta: number) => void; onStockSave: () => void;
    isSavingStock: boolean; hasBOM?: boolean; disabled?: boolean; stockUnavailable?: boolean; currency?: string;
}
export const VariantTableRow = memo(function VariantTableRow({ variant: v, isExpanded, onToggleExpand, onFieldChange, stockEditValue, onStockEditChange, onStockAdjust, onStockSave, isSavingStock, hasBOM, disabled, stockUnavailable, currency }: Props) {
    const locked = disabled || isSavingStock; const stock = parseVariantStock(stockEditValue);
    const image = getVariantImage(v); const inputClass = `${ui.input} px-2 py-1.5`;
    return <tr className={`text-slate-900 transition-colors dark:text-slate-100 ${isExpanded ? 'bg-[var(--brand-subtle)] ' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
        <td className="p-2"><button className={`${ui.secondary} p-1.5`} type="button" disabled={locked} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} variant ${v.id}`} aria-expanded={isExpanded} onClick={onToggleExpand}><ChevronDown size={14} className={isExpanded ? '' : '-rotate-90'} /></button></td>
        <td className="px-2 py-3">{image ? <img src={image} alt="" className="size-12 rounded-lg border border-slate-200 object-cover dark:border-slate-700" loading="lazy" /> : <span className="flex size-12 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800"><Package size={18} /></span>}</td>
        <td className="max-w-48 break-words p-2 text-xs font-medium">{v.attributes?.map(attribute => `${attribute.name}: ${attribute.option}`).join(', ') || `#${v.id}`}</td>
        {(['sku', 'price', 'salePrice', 'weight'] as const).map(field => <td className="p-2" key={field}>
            {(field === 'price' || field === 'salePrice') && <span className={`mb-1 block text-[10px] ${ui.muted}`}>{currency || 'Currency unavailable'}</span>}
            <input className={inputClass} disabled={locked} aria-label={`${field === 'salePrice' ? 'Sale price' : field === 'sku' ? 'SKU' : field === 'price' ? 'Price' : 'Weight'} for variant ${v.id}`} type={field === 'sku' ? 'text' : 'number'} min={field === 'sku' ? undefined : '0'} step="any" value={v[field] ?? ''} onChange={event => onFieldChange(field, event.target.value)} />
        </td>)}
        <td className="p-2"><div className="flex gap-1">{(['length', 'width', 'height'] as const).map(field => <input key={field} className={`${inputClass} min-w-12`} disabled={locked} aria-label={`${field} for variant ${v.id}`} type="number" min="0" step="any" value={v.dimensions?.[field] ?? ''} onChange={event => onFieldChange('dimensions', { ...v.dimensions, [field]: event.target.value })} />)}</div></td>
        <td className="p-2">{stockUnavailable ? <span className={ui.muted}>BOM status unavailable; stock editing locked</span> : hasBOM ? <span className={ui.badge}>{v.stockQuantity ?? 'Unavailable'} · BOM managed</span> : v.manageStock ? <div className="flex min-w-44 flex-wrap items-center gap-1">
            <button className={`${ui.secondary} px-2 py-1.5`} type="button" disabled={locked || stock === null || stock === 0} aria-label={`Decrease stock for variant ${v.id}`} onClick={() => onStockAdjust(-1)}>−</button>
            <input aria-label={`Stock for variant ${v.id}`} aria-invalid={stock === null} className={cn(inputClass, 'w-20 text-center tabular-nums')} type="text" inputMode="numeric" disabled={locked} value={stockEditValue} onChange={event => onStockEditChange(event.target.value)} />
            <button className={`${ui.secondary} px-2 py-1.5`} type="button" disabled={locked || stock === null || stock === Number.MAX_SAFE_INTEGER} aria-label={`Increase stock for variant ${v.id}`} onClick={() => onStockAdjust(1)}>+</button>
            <button className={`${ui.primary} px-2 py-1.5`} type="button" aria-label={`Save stock for variant ${v.id}`} disabled={locked || stock === null || stock === v.stockQuantity} onClick={onStockSave}><Save size={12} />{isSavingStock ? 'Saving...' : 'Save'}</button>
            {stock === null && <span className="text-xs">Enter a nonnegative whole number.</span>}
        </div> : <span>Not tracked</span>}</td>
    </tr>;
});
