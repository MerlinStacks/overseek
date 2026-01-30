import { useEffect, useState } from 'react';
import { Logger } from '../utils/logger';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Search, Package, Loader2, Layers, Truck, Calculator, Plus, Box, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { SuppliersList } from '../components/inventory/SuppliersList';
// import { BOMEditor } from '../components/inventory/BOMEditor';
// import { BOMEditor } from '../components/inventory/BOMEditor';
import { ProductSeoModal } from '../components/inventory/ProductSeoModal';
import { PurchaseOrderList } from '../components/inventory/PurchaseOrderList';
import { SeoScoreBadge } from '../components/Seo/SeoScoreBadge';

import { Pagination } from '../components/ui/Pagination';
import { InternalProductsList } from '../components/inventory/InternalProductsList';

interface Product {
    // Updated Product Interface
    id: string;
    wooId?: number;
    name: string;
    sku: string;
    stock_status: string;
    stock_quantity?: number;
    low_stock_amount?: number;
    price: string;
    mainImage?: string;
    images?: Array<{ src: string }>;
    categories?: Array<{ name: string }>;

    // Scoring
    seoScore?: number;
    merchantCenterScore?: number;
    seoData?: any;
    merchantCenterIssues?: any;
    variations?: Array<{
        id: number;
        stock_quantity: number | null;
        stock_status: string;
        price: string;
        sku: string;
    }>;
    /** Variant data from ProductVariation table with accurate stock */
    searchableVariants?: Array<{
        id: string;
        wooId: number;
        sku: string;
        stockQuantity: number | null;
        stockStatus: string;
    }>;
}

import { ProductService } from '../services/ProductService';

export function InventoryPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Read initial tab from URL query param, default to 'catalog'
    const tabFromUrl = searchParams.get('tab') as 'catalog' | 'suppliers' | 'purchasing' | 'components' | null;
    const validTabs = ['catalog', 'suppliers', 'purchasing', 'components'];
    const initialTab = (tabFromUrl && validTabs.includes(tabFromUrl)) ? tabFromUrl : 'catalog';
    const [activeTab, setActiveTab] = useState<'catalog' | 'suppliers' | 'purchasing' | 'components'>(initialTab);

    // Sync URL when tab changes
    useEffect(() => {
        const currentTabParam = searchParams.get('tab');
        if (activeTab !== 'catalog' && currentTabParam !== activeTab) {
            setSearchParams({ tab: activeTab }, { replace: true });
        } else if (activeTab === 'catalog' && currentTabParam) {
            // Remove tab param when on default catalog tab
            searchParams.delete('tab');
            setSearchParams(searchParams, { replace: true });
        }
    }, [activeTab]);

    // Catalog State
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortField, setSortField] = useState<'name' | 'price' | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [debouncedQuery, setDebouncedQuery] = useState('');

    // BOM State
    // const [editingBOM, setEditingBOM] = useState<string | null>(null);
    const [viewingSeo, setViewingSeo] = useState<Product | null>(null);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
            setPage(1); // Reset to page 1 on new search
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        if (activeTab === 'catalog') {
            fetchProducts();
        }
    }, [currentAccount, token, debouncedQuery, page, limit, activeTab]);

    async function fetchProducts() {
        if (!currentAccount || !token) return;

        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                q: debouncedQuery
            });

            const res = await fetch(`/api/products?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setProducts(data.products);
                setTotalPages(data.totalPages);
                setTotalItems(data.total);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleCreateProduct() {
        if (!currentAccount || !token) return;
        const name = prompt('Enter new product name:');
        if (!name) return;

        setIsCreating(true);
        try {
            const newProduct = await ProductService.createProduct({ name }, token, currentAccount.id);
            navigate(`/inventory/product/${newProduct.id}`);
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            alert('Failed to create product');
        } finally {
            setIsCreating(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-end border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
                    <p className="text-sm text-gray-500">Manage products, materials, and suppliers</p>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={handleCreateProduct}
                        disabled={isCreating}
                        className="flex items-center gap-2 pb-2 -mb-4 px-2 font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >
                        {isCreating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                        New Product
                    </button>
                    <button
                        onClick={() => setActiveTab('catalog')}
                        className={`flex items-center gap-2 pb-2 -mb-4 px-2 font-medium transition-colors border-b-2 ${activeTab === 'catalog' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        <Layers size={18} /> Product Catalog
                    </button>
                    <button
                        onClick={() => setActiveTab('suppliers')}
                        className={`flex items-center gap-2 pb-2 -mb-4 px-2 font-medium transition-colors border-b-2 ${activeTab === 'suppliers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        <Truck size={18} /> Suppliers & Materials
                    </button>
                    <button
                        onClick={() => setActiveTab('purchasing')}
                        className={`flex items-center gap-2 pb-2 -mb-4 px-2 font-medium transition-colors border-b-2 ${activeTab === 'purchasing' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        <Calculator size={18} /> Purchasing
                    </button>
                    <button
                        onClick={() => setActiveTab('components')}
                        className={`flex items-center gap-2 pb-2 -mb-4 px-2 font-medium transition-colors border-b-2 ${activeTab === 'components' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                        <Box size={18} /> Components
                    </button>

                </div>
            </div>

            {
                activeTab === 'suppliers' ? (
                    <SuppliersList />
                ) : activeTab === 'purchasing' ? (
                    <PurchaseOrderList />
                ) : activeTab === 'components' ? (
                    <InternalProductsList />
                ) : (
                    <>
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                {sortField && (
                                    <>
                                        <span>Sorted by <span className="font-medium text-gray-700">{sortField === 'name' ? 'Name' : 'Price'}</span></span>
                                        <button
                                            onClick={() => setSortField(null)}
                                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                                        >
                                            Clear
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search products..."
                                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-hidden focus:ring-2 focus:ring-blue-500 w-64"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                                        <th className="px-6 py-4 w-16">Image</th>
                                        <th className="px-6 py-4">
                                            <button
                                                onClick={() => {
                                                    if (sortField === 'name') {
                                                        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                    } else {
                                                        setSortField('name');
                                                        setSortDirection('asc');
                                                    }
                                                }}
                                                className="flex items-center gap-1 hover:text-gray-700 transition-colors group"
                                            >
                                                Product Name
                                                {sortField === 'name' ? (
                                                    sortDirection === 'asc' ? <ArrowUp size={14} className="text-blue-600" /> : <ArrowDown size={14} className="text-blue-600" />
                                                ) : (
                                                    <ArrowUpDown size={14} className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                )}
                                            </button>
                                        </th>
                                        <th className="px-6 py-4">SKU</th>
                                        <th className="px-6 py-4">Stock</th>
                                        <th className="px-6 py-4">
                                            <button
                                                onClick={() => {
                                                    if (sortField === 'price') {
                                                        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                                                    } else {
                                                        setSortField('price');
                                                        setSortDirection('asc');
                                                    }
                                                }}
                                                className="flex items-center gap-1 hover:text-gray-700 transition-colors group"
                                            >
                                                Price
                                                {sortField === 'price' ? (
                                                    sortDirection === 'asc' ? <ArrowUp size={14} className="text-blue-600" /> : <ArrowDown size={14} className="text-blue-600" />
                                                ) : (
                                                    <ArrowUpDown size={14} className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                )}
                                            </button>
                                        </th>
                                        <th className="px-6 py-4">SEO / GMC</th>
                                        <th className="px-6 py-4 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {isLoading ? (
                                        <tr><td colSpan={6} className="p-12 text-center"><Loader2 className="animate-spin inline text-blue-600" /></td></tr>
                                    ) : products.length === 0 ? (
                                        <tr><td colSpan={6} className="p-12 text-center text-gray-500 flex flex-col items-center gap-2">
                                            <Package size={48} className="text-gray-300" />
                                            <p>No products found.</p>
                                        </td></tr>
                                    ) : (
                                        [...products]
                                            .sort((a, b) => {
                                                if (!sortField) return 0;
                                                if (sortField === 'name') {
                                                    const nameA = a.name.toLowerCase();
                                                    const nameB = b.name.toLowerCase();
                                                    return sortDirection === 'asc'
                                                        ? nameA.localeCompare(nameB)
                                                        : nameB.localeCompare(nameA);
                                                }
                                                if (sortField === 'price') {
                                                    const priceA = parseFloat(a.price) || 0;
                                                    const priceB = parseFloat(b.price) || 0;
                                                    return sortDirection === 'asc' ? priceA - priceB : priceB - priceA;
                                                }
                                                return 0;
                                            })
                                            .map((product) => (
                                                <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <div className="w-10 h-10 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                                                            {(product.mainImage || product.images?.[0]?.src) ? (
                                                                <img src={product.mainImage || product.images?.[0]?.src} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-gray-400"><Package size={16} /></div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 font-medium text-gray-900">
                                                        <Link to={`/inventory/product/${product.wooId || product.id}`} className="hover:text-blue-600 transition-colors">
                                                            {product.name}
                                                        </Link>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm font-mono text-gray-500">{product.sku || '-'}</td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col gap-1">
                                                            {product.searchableVariants && product.searchableVariants.length > 0 ? (
                                                                // Variable Product Stock Logic - uses searchableVariants from ProductVariation table
                                                                (() => {
                                                                    const totalStock = product.searchableVariants.reduce((sum, v) => sum + (v.stockQuantity || 0), 0);
                                                                    const breakdown = product.searchableVariants.map(v => v.stockQuantity || 0).join(', ');
                                                                    return (
                                                                        <div className="flex flex-col">
                                                                            <span className={`text-lg font-bold text-gray-900`}>
                                                                                {totalStock}
                                                                            </span>
                                                                            <span className="text-xs text-gray-500 font-mono">
                                                                                ({breakdown})
                                                                            </span>
                                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 text-purple-700 mt-1 w-fit">
                                                                                Variable
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })()
                                                            ) : (
                                                                // Simple Product Logic
                                                                <>
                                                                    {product.stock_quantity !== undefined && product.stock_quantity !== null && (
                                                                        <span className={`text-lg font-bold ${product.stock_quantity === 0 ? 'text-red-600' :
                                                                            (product.low_stock_amount && product.stock_quantity <= product.low_stock_amount) ? 'text-amber-600' :
                                                                                'text-gray-900'
                                                                            }`}>
                                                                            {product.stock_quantity}
                                                                        </span>
                                                                    )}
                                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize w-fit
                                                                ${product.stock_status === 'instock' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                                        {product.stock_status === 'instock' ? 'In Stock' : 'Out of Stock'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                                        {product.price ? `$${product.price}` : '-'}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <button
                                                            onClick={() => setViewingSeo(product)}
                                                            className="flex flex-col gap-1 items-start hover:opacity-80 transition-opacity"
                                                        >
                                                            <SeoScoreBadge score={product.seoScore || 0} size="sm" />
                                                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${(product.merchantCenterScore || 0) === 100
                                                                ? 'bg-blue-50 text-blue-700 border-blue-100'
                                                                : 'bg-orange-50 text-orange-700 border-orange-100'
                                                                }`}>
                                                                GMC: {product.merchantCenterScore || 0}%
                                                            </span>
                                                        </button>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <button
                                                            onClick={() => navigate(`/inventory/product/${product.wooId || product.id}`)}
                                                            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                                                        >
                                                            Edit
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                    )}
                                </tbody>
                            </table>
                            {!isLoading && products.length > 0 && (
                                <Pagination
                                    currentPage={page}
                                    totalPages={totalPages}
                                    onPageChange={setPage}
                                    itemsPerPage={limit}
                                    onItemsPerPageChange={(newLimit) => {
                                        setLimit(newLimit);
                                        setPage(1);
                                    }}
                                    allowItemsPerPage={true}
                                />
                            )}
                        </div>
                    </>
                )
            }

            {
                viewingSeo && (
                    <ProductSeoModal
                        product={viewingSeo}
                        onClose={() => setViewingSeo(null)}
                    />
                )
            }
        </div >
    );
}
