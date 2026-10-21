import { useState } from 'react';
import { type WizardStepProps, type WizardProduct } from '../types';
import { useAuth } from '../../../../context/AuthContext';
import { useAccount } from '../../../../context/AccountContext';
import { useScopedRequest } from '../../../../hooks/useScopedRequest';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { isRecord } from '../../../../utils/responseValidation';
import { reportMoney } from '../../../analytics/useReportRequest';

function decodeProducts(value: unknown): WizardProduct[] {
    if (!isRecord(value) || !Array.isArray(value.products)) throw new Error('Invalid products');
    return value.products.map(product => {
        if (!isRecord(product) || !['number', 'string'].includes(typeof product.wooId) || !String(product.wooId).trim() || typeof product.name !== 'string') throw new Error('Invalid product');
        const price = typeof product.price === 'number' || (typeof product.price === 'string' && /^\d+(?:\.\d+)?$/.test(product.price)) ? Number(product.price) : NaN;
        return { id: String(product.wooId), name: product.name, price: Number.isFinite(price) && price >= 0 ? price : null, sku: typeof product.sku === 'string' ? product.sku : undefined };
    });
}
export function StepProductSelection(props: WizardStepProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="alert">Select an account to load products.</p>;
    return <ScopedProducts key={JSON.stringify([token, currentAccount.id])} {...props} token={token} accountId={currentAccount.id} currency={currentAccount.currency} />;
}
function ScopedProducts(props: WizardStepProps & { token: string; accountId: string; currency?: string }) {
    const [query, setQuery] = useState(''); const debounced = useDebouncedValue(query, 300);
    return <section className="space-y-4 text-slate-900 dark:text-slate-100"><h3 className="text-2xl font-bold">Select products (optional)</h3>
        <label className="block">Search products<input className="block w-full p-2 border rounded-lg bg-white dark:bg-slate-900" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <p>Up to 100 matching products are shown. Search by name or SKU to find other products. Prices use the store currency, not the ad-account currency.</p>
        {query !== debounced ? <p role="status">Searching...</p> : <ProductResults key={debounced} {...props} query={debounced} />}
        <p>{props.draft.selectedProducts.length} selected</p>
        <ul>{props.draft.selectedProducts.map(product => <li key={product.id}>{product.name} <button type="button" aria-label={`Remove ${product.name}`} onClick={() => props.setDraft(current => ({ ...current, selectedProducts: current.selectedProducts.filter(item => item.id !== product.id) }))}>Remove</button></li>)}</ul>
    </section>;
}
function ProductResults({ draft, setDraft, query, token, accountId, currency }: WizardStepProps & { query: string; token: string; accountId: string; currency?: string }) {
    const request = useScopedRequest(`/api/products?limit=100&q=${encodeURIComponent(query)}`, accountId, token, decodeProducts);
    if (request.loading) return <p role="status">Loading products...</p>;
    if (request.error) return <p role="alert">Products unavailable. <button type="button" onClick={request.retry}>Retry</button></p>;
    if (!request.data?.length) return <p>No matching products.</p>;
    return <ul className="space-y-2">{request.data.map(product => <li key={product.id}><button type="button" aria-pressed={draft.selectedProducts.some(item => item.id === product.id)} className="w-full text-left p-3 border rounded-lg" onClick={() => setDraft(current => ({ ...current, selectedProducts: current.selectedProducts.some(item => item.id === product.id) ? current.selectedProducts.filter(item => item.id !== product.id) : [...current.selectedProducts, product] }))}>{product.name} {product.sku} · {reportMoney(product.price ?? NaN, currency)}</button></li>)}</ul>;
}
