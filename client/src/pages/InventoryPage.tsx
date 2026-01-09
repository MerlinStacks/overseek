import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Search, Package, Loader2, Layers, Truck, Calculator } from 'lucide-react';
import { SuppliersList } from '../components/inventory/SuppliersList';
// import { BOMEditor } from '../components/inventory/BOMEditor';
// import { BOMEditor } from '../components/inventory/BOMEditor';
import { ProductSeoModal } from '../components/inventory/ProductSeoModal';
import { PurchaseOrderList } from '../components/inventory/PurchaseOrderList';
import { SeoScoreBadge } from '../components/Seo/SeoScoreBadge';

import { Pagination } from '../components/ui/Pagination';

interface Product {
    // Updated Product Interface
    id: string;
    name: string;
    sku: string;
    stock_status: string;
    price: string;
    mainImage?: string;
    images?: Array<{ src: string }>;
    categories?: Array<{ name: string }>;

    // Scoring
    seoScore?: number;
    merchantCenterScore?: number;
    seoData?: any;
    merchantCenterIssues?: any;
}

export function InventoryPage() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [activeTab, setActiveTab] = useState<'catalog' | 'suppliers' | 'purchasing'>('catalog');

    // Catalog State
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
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
            console.error(err);
        } finally {
            setIsLoading(false);
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

                </div>
            </div>

            {
                activeTab === 'suppliers' ? (
                    <SuppliersList />
                ) : activeTab === 'purchasing' ? (
                    <PurchaseOrderList />

                ) : (
                    <>
                        <div className="flex justify-end mb-4">
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
                                        <th className="px-6 py-4">Product Name</th>
                                        <th className="px-6 py-4">SKU</th>
                                        <th className="px-6 py-4">Stock</th>
                                        <th className="px-6 py-4">Price</th>
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
                                        products.map((product) => (
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
                                                <td className="px-6 py-4 font-medium text-gray-900">{product.name}</td>
                                                <td className="px-6 py-4 text-sm font-mono text-gray-500">{product.sku || '-'}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                                                    ${product.stock_status === 'instock' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                        {product.stock_status === 'instock' ? 'In Stock' : 'Out of Stock'}
                                                    </span>
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
                                                        onClick={() => navigate(`/inventory/product/${product.id}`)}
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
