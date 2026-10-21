import { reportMoney } from '../../analytics/useReportRequest';
import { bomNumber, validStock } from './bomValues';

export interface BOMSearchResultVariant { id?: string | number; wooId: number; sku?: string; cogs?: number; stockQuantity?: number; attributeString?: string }
export interface BOMSearchResultProduct {
    id: string; name: string; sku?: string; cogs?: number; price?: number; stockQuantity?: number; hasBOM?: boolean;
    isInternalProduct?: boolean; mainImage?: string; searchableVariants?: BOMSearchResultVariant[]; isVariant?: boolean; variantId?: number;
}
export interface BOMSearchDropdownProps {
    searchTerm: string; onSearchChange: (value: string) => void; searchResults: BOMSearchResultProduct[]; productId: string;
    onAddProduct: (product: BOMSearchResultProduct) => void; currency?: string; loading?: boolean; error?: boolean; onRetry?: () => void; disabled?: boolean; hideSearchInput?: boolean;
}
export function BOMSearchDropdown({ searchTerm, onSearchChange, searchResults, productId, onAddProduct, currency, loading, error, onRetry, disabled, hideSearchInput }: BOMSearchDropdownProps) {
    const results = searchResults.filter(product => product.isInternalProduct || (!product.hasBOM && product.id !== productId));
    return <fieldset disabled={disabled} className="space-y-3 text-slate-900 dark:text-slate-100">{!hideSearchInput && <label className="block">Add Product Component<input className="block w-full p-2 border rounded-lg bg-white dark:bg-slate-900" placeholder="Search by product name or SKU..." value={searchTerm} onChange={event => onSearchChange(event.target.value)} /></label>}
        {loading ? <p role="status">Searching components...</p> : error ? <p role="alert">Component search unavailable. <button type="button" onClick={onRetry}>Retry</button></p> : searchTerm.trim().length >= 2 && <div className="max-h-96 overflow-y-auto space-y-2">
            {!results.length && <p>No eligible components found.</p>}
            {results.map(product => <div key={`${product.isInternalProduct ? 'internal' : 'woo'}:${product.id}`} className="p-3 border rounded-lg">
                <button type="button" disabled={!product.isInternalProduct && !!product.searchableVariants?.length} onClick={() => onAddProduct(product)} className="w-full text-left">
                    {product.name} {product.isInternalProduct ? '(Internal)' : ''} {product.sku} · COGS: {reportMoney(bomNumber(product.cogs), currency)} · Stock: {validStock(product.stockQuantity) ? product.stockQuantity : 'Unavailable'}
                </button>
                {product.searchableVariants?.map(variant => <button type="button" key={variant.wooId} className="block text-left p-2" onClick={() => onAddProduct({ id: product.id, name: `${product.name} - ${variant.attributeString || variant.sku || `#${variant.wooId}`}`, cogs: variant.cogs, sku: variant.sku, stockQuantity: variant.stockQuantity, variantId: variant.wooId, isVariant: true })}>
                    {variant.attributeString || `Variant #${variant.wooId}`} {variant.sku} · COGS: {reportMoney(bomNumber(variant.cogs), currency)} · Stock: {validStock(variant.stockQuantity) ? variant.stockQuantity : 'Unavailable'}
                </button>)}
            </div>)}
        </div>}
    </fieldset>;
}
