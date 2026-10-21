import { memo } from 'react';
import { type ProductVariant, getVariantImage, parseVariantStock } from './variantTypes';

interface Props {
    variant: ProductVariant; isExpanded: boolean; onToggleExpand: () => void;
    onFieldChange: (field: keyof ProductVariant, value: ProductVariant[keyof ProductVariant]) => void;
    stockEditValue: string; onStockEditChange: (value: string) => void; onStockAdjust: (delta: number) => void; onStockSave: () => void;
    isSavingStock: boolean; hasBOM?: boolean; disabled?: boolean; stockUnavailable?: boolean; currency?: string;
}
export const VariantTableRow = memo(function VariantTableRow({ variant: v, isExpanded, onToggleExpand, onFieldChange, stockEditValue, onStockEditChange, onStockAdjust, onStockSave, isSavingStock, hasBOM, disabled, stockUnavailable, currency }: Props) {
    const locked = disabled || isSavingStock; const stock = parseVariantStock(stockEditValue);
    const image = getVariantImage(v); const inputClass = 'w-full p-2 border rounded-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 disabled:opacity-50';
    return <tr className="text-slate-900 dark:text-slate-100">
        <td className="p-2"><button type="button" disabled={locked} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} variant ${v.id}`} aria-expanded={isExpanded} onClick={onToggleExpand}>{isExpanded ? '−' : '+'}</button></td>
        <td>{image && <img src={image} alt="" className="w-12 h-12 object-cover rounded-lg" loading="lazy" />}</td>
        <td className="p-2">{v.attributes?.map(attribute => `${attribute.name}: ${attribute.option}`).join(', ') || `#${v.id}`}</td>
        {(['sku', 'price', 'salePrice', 'weight'] as const).map(field => <td className="p-2" key={field}>
            {(field === 'price' || field === 'salePrice') && <span className="text-xs">{currency || 'Currency unavailable'}</span>}
            <input className={inputClass} disabled={locked} aria-label={`${field === 'salePrice' ? 'Sale price' : field === 'sku' ? 'SKU' : field === 'price' ? 'Price' : 'Weight'} for variant ${v.id}`} type={field === 'sku' ? 'text' : 'number'} min={field === 'sku' ? undefined : '0'} step="any" value={v[field] ?? ''} onChange={event => onFieldChange(field, event.target.value)} />
        </td>)}
        <td className="p-2"><div className="flex gap-1">{(['length', 'width', 'height'] as const).map(field => <input key={field} className={`${inputClass} min-w-12`} disabled={locked} aria-label={`${field} for variant ${v.id}`} type="number" min="0" step="any" value={v.dimensions?.[field] ?? ''} onChange={event => onFieldChange('dimensions', { ...v.dimensions, [field]: event.target.value })} />)}</div></td>
        <td className="p-2">{stockUnavailable ? <span>BOM status unavailable; stock editing locked</span> : hasBOM ? <span>{v.stockQuantity ?? 'Unavailable'} · BOM managed</span> : v.manageStock ? <div className="flex flex-wrap gap-1">
            <button type="button" disabled={locked || stock === null || stock === 0} aria-label={`Decrease stock for variant ${v.id}`} onClick={() => onStockAdjust(-1)}>−</button>
            <input aria-label={`Stock for variant ${v.id}`} aria-invalid={stock === null} className={`${inputClass} w-20`} type="text" inputMode="numeric" disabled={locked} value={stockEditValue} onChange={event => onStockEditChange(event.target.value)} />
            <button type="button" disabled={locked || stock === null || stock === Number.MAX_SAFE_INTEGER} aria-label={`Increase stock for variant ${v.id}`} onClick={() => onStockAdjust(1)}>+</button>
            <button type="button" aria-label={`Save stock for variant ${v.id}`} disabled={locked || stock === null || stock === v.stockQuantity} onClick={onStockSave}>{isSavingStock ? 'Saving...' : 'Save'}</button>
            {stock === null && <span className="text-xs">Enter a nonnegative whole number.</span>}
        </div> : <span>Not tracked</span>}</td>
    </tr>;
});
