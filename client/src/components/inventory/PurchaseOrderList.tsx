import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Plus, Loader2, FileText } from 'lucide-react';

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
    itemCount: number; // Computed or we need to include items and count
    items?: any[];
}

export function PurchaseOrderList() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    onClick={() => navigate('/inventory/purchase-orders/new')}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus size={18} /> New Purchase Order
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
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
                        ) : orders.length === 0 ? (
                            <tr><td colSpan={7} className="p-12 text-center text-gray-500 flex flex-col items-center gap-2">
                                <FileText size={48} className="text-gray-300" />
                                <p>No purchase orders found.</p>
                            </td></tr>
                        ) : (
                            orders.map((po) => (
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
