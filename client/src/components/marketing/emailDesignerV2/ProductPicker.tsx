import { useState } from 'react';
import { useAccount } from '../../../context/AccountContext';
import { useAuth } from '../../../context/AuthContext';
import { useScopedRequest } from '../../../hooks/useScopedRequest';
import { isRecord } from '../../../utils/responseValidation';
import { convertProductToBlock, type EmailDesignerProduct } from './productBlockProps';
function decode(value: unknown): EmailDesignerProduct[] { if (!isRecord(value) || !Array.isArray(value.products) || value.products.length > 8) throw new Error('Invalid product sample'); value.products.forEach(convertProductToBlock); return value.products; }
export function ProductPicker({ onSelect }: { onSelect: (product: EmailDesignerProduct) => void }) {
    const { token, user } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Select an account and sign in.</p>;
    return <ScopedPicker key={JSON.stringify([user?.id, token, currentAccount.id])} token={token} accountId={currentAccount.id} onSelect={onSelect} />;
}
function ScopedPicker(props: { token: string; accountId: string; onSelect: (product: EmailDesignerProduct) => void }) { const [query, setQuery] = useState(''); return <div className="space-y-3 rounded border p-3"><label>Search products<input className="block w-full bg-white dark:bg-slate-900" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><PickerRead key={query} {...props} query={query} /></div>; }
function PickerRead({ token, accountId, onSelect, query }: { token: string; accountId: string; query: string; onSelect: (product: EmailDesignerProduct) => void }) {
    const read = useScopedRequest(`/api/products?${new URLSearchParams({ limit: '8', q: query })}`, accountId, token, decode), [error, setError] = useState('');
    if (read.loading) return <p role="status">Loading product sample…</p>;
    if (read.error || !read.data) return <p role="alert">Product sample unavailable. <button type="button" onClick={read.retry}>Retry products</button></p>;
    return <div className="max-h-64 overflow-auto space-y-2">{error && <p role="alert">{error}</p>}{!read.data.length && <p>No matching products in this sample.</p>}{read.data.map(product => { const { props, unavailable } = convertProductToBlock(product); return <div className="rounded border p-2 text-slate-900 dark:text-slate-100" key={product.id}><button type="button" className="text-left" onClick={() => { try { onSelect(product); } catch { setError('Product could not be inserted; existing content was not replaced.'); } }}><strong>{props.productName}</strong><p>Source price: {props.productPrice || 'Unavailable'} (currency unverified)</p></button><p className="text-xs">{unavailable.join(' · ')}</p></div>; })}</div>;
}
