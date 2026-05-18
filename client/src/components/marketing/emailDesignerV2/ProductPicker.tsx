import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useAccount } from '../../../context/AccountContext';
import { useAuth } from '../../../context/AuthContext';
import type { ProductBlock } from '../../../lib/emailDesignerV2';

export interface EmailDesignerProduct {
    id: string;
    wooId?: number;
    name: string;
    price?: number | string;
    mainImage?: string | null;
    images?: Array<{ src?: string }>;
    permalink?: string;
    short_description?: string;
    description?: string;
    rawData?: {
        permalink?: string;
        short_description?: string;
        description?: string;
    };
}

const stripTags = (value?: string) => (value || '').replace(/<[^>]*>/g, '').trim();

const getProductImage = (product: EmailDesignerProduct) => product.mainImage || product.images?.[0]?.src || '';
const getProductDescription = (product: EmailDesignerProduct) => stripTags(product.short_description || product.description || product.rawData?.short_description || product.rawData?.description);
const getProductUrl = (product: EmailDesignerProduct) => product.permalink || product.rawData?.permalink || '{{store_url}}';

export function productToBlockProps(product: EmailDesignerProduct): Partial<ProductBlock['props']> {
    return {
        productId: product.id,
        productWooId: product.wooId,
        productName: product.name,
        productImage: getProductImage(product),
        productPrice: product.price !== undefined && product.price !== null ? String(product.price) : '',
        productDescription: getProductDescription(product),
        productUrl: getProductUrl(product),
        buttonHref: getProductUrl(product),
    };
}

export function ProductPicker({ onSelect }: { onSelect: (product: EmailDesignerProduct) => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [query, setQuery] = useState('');
    const [products, setProducts] = useState<EmailDesignerProduct[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!token || !currentAccount) return;
        const controller = new AbortController();
        const timeout = window.setTimeout(async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams({ limit: '8', q: query });
                const response = await fetch(`/api/products?${params}`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id,
                    },
                    signal: controller.signal,
                });
                if (!response.ok) return;
                const payload = await response.json() as { products?: EmailDesignerProduct[] };
                setProducts(payload.products || []);
            } catch (error) {
                if ((error as Error).name !== 'AbortError') setProducts([]);
            } finally {
                setLoading(false);
            }
        }, 250);

        return () => {
            window.clearTimeout(timeout);
            controller.abort();
        };
    }, [currentAccount, query, token]);

    return (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
                <Search size={14} className="text-slate-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" className="w-full border-0 bg-transparent p-0 text-sm focus:ring-0 dark:text-white" />
                {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
            </label>
            <div className="max-h-56 space-y-2 overflow-auto">
                {products.map((product) => (
                    <button key={product.id} onClick={() => onSelect(product)} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-2 text-left hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:hover:bg-indigo-950/30">
                        {getProductImage(product) ? <img src={getProductImage(product)} alt="" className="h-10 w-10 rounded-md object-cover" /> : <div className="h-10 w-10 rounded-md bg-slate-100 dark:bg-slate-800" />}
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{product.name}</p>
                            <p className="text-xs text-slate-500">{product.price !== undefined && product.price !== null ? String(product.price) : 'No price'}</p>
                        </div>
                    </button>
                ))}
                {!loading && products.length === 0 && <p className="text-sm text-slate-500">No products found.</p>}
            </div>
        </div>
    );
}
