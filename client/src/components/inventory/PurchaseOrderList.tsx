import { useState, useEffect, useMemo } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Loader2, FileText, Package, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface PurchaseOrder {
    id: string;
    orderNumber: string | null;
    status: string;
    totalAmount: string;
    supplier: {
        name: string;
    };
    orderDate: string | null;
    expectedDate: string | null;
    createdAt: string;
    items?: any[];
}

type StatusFilter = 'ALL' | 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';

const STATUS_TABS: { key: StatusFilter; label: string; icon: React.ReactNode }[] = [
    { key: 'ALL', label: 'All Orders', icon: <Package size={16} /> },
    { key: 'DRAFT', label: 'Drafts', icon: <FileText size={16} /> },
    { key: 'ORDERED', label: 'Ordered', icon: <Clock size={16} /> },
    { key: 'RECEIVED', label: 'Received', icon: <CheckCircle2 size={16} /> },
];

export function PurchaseOrderList() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

    useEffect(() => {
        if (currentAccount) {
            fetchOrders();
        }
    }, [currentAccount, token]);

    async function fetchOrders() {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/inventory/purchase-orders`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setOrders(data);
            }
        } catch (error) {
            Logger.error('An error occurred', { error: error });
        } finally {
            setIsLoading(false);
        }
    }

    // Compute stats
    const stats = useMemo(() => {
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        const drafts = orders.filter(o => o.status === 'DRAFT').length;
        const ordered = orders.filter(o => o.status === 'ORDERED');
        const pendingValue = ordered.reduce((sum, o) => sum + (parseFloat(o.totalAmount) || 0), 0);
        const receivedThisMonth = orders.filter(o => {
            if (o.status !== 'RECEIVED') return false;
            const date = new Date(o.createdAt);
            return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
        }).length;

        return { drafts, pendingOrders: ordered.length, pendingValue, receivedThisMonth };
    }, [orders]);

    // Filter orders
    const filteredOrders = useMemo(() => {
        if (statusFilter === 'ALL') return orders;
        return orders.filter(o => o.status === statusFilter);
    }, [orders, statusFilter]);

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-100 rounded-lg">
                            <FileText size={20} className="text-gray-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{stats.drafts}</p>
                            <p className="text-xs text-gray-500">Draft Orders</p>
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-white p-4 rounded-xl border border-blue-100 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <Clock size={20} className="text-blue-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-blue-900">{stats.pendingOrders}</p>
                            <p className="text-xs text-blue-600">Pending Delivery</p>
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-amber-50 to-white p-4 rounded-xl border border-amber-100 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded-lg">
                            <AlertCircle size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-amber-900">${stats.pendingValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                            <p className="text-xs text-amber-600">Pending Value</p>
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-white p-4 rounded-xl border border-green-100 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <CheckCircle2 size={20} className="text-green-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-green-900">{stats.receivedThisMonth}</p>
                            <p className="text-xs text-green-600">Received This Month</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Header with Tabs and Action */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {STATUS_TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setStatusFilter(tab.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${statusFilter === tab.key
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                <button
                    onClick={() => navigate('/inventory/purchase-orders/new')}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                    <Plus size={18} />
                    New Purchase Order
                </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                            <th className="px-6 py-4">PO Number</th>
                            <th className="px-6 py-4">Supplier</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Date</th>
                            <th className="px-6 py-4">Expected</th>
                            <th className="px-6 py-4">Total</th>
                            <th className="px-6 py-4 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {isLoading ? (
                            <tr><td colSpan={7} className="p-12 text-center"><Loader2 className="animate-spin inline text-blue-600" /></td></tr>
                        ) : filteredOrders.length === 0 ? (
                            <tr><td colSpan={7} className="p-12 text-center text-gray-500">
                                <div className="flex flex-col items-center gap-2">
                                    <FileText size={48} className="text-gray-300" />
                                    <p>No {statusFilter !== 'ALL' ? statusFilter.toLowerCase() : ''} purchase orders found.</p>
                                </div>
                            </td></tr>
                        ) : (
                            filteredOrders.map((po) => (
                                <tr key={po.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900">{po.orderNumber || po.id.substring(0, 8).toUpperCase()}</td>
                                    <td className="px-6 py-4 text-gray-600">{po.supplier?.name || 'Unknown'}</td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
                                            ${po.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' :
                                                po.status === 'ORDERED' ? 'bg-blue-100 text-blue-800' :
                                                    po.status === 'RECEIVED' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {po.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                        {po.orderDate ? new Date(po.orderDate).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-500">
                                        {po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-6 py-4 font-medium text-gray-900">
                                        {po.totalAmount ? `$${Number(po.totalAmount).toFixed(2)}` : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <button
                                            onClick={() => navigate(`/inventory/purchase-orders/${po.id}`)}
                                            className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                                        >
                                            View
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
