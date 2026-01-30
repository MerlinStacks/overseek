import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, MapPin, ShoppingBag, Calendar, RefreshCw, Package, ChevronRight, DollarSign } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatCurrency, formatDate } from '../../utils/format';
import { getStatusColor } from '../../utils/orderStatus';

interface OrderApiResponse {
    id: string;
    rawData?: {
        number?: string;
        status?: string;
        total?: string | number;
        date_created?: string;
    };
    wooId?: string;
    status?: string;
    total?: string | number;
    dateCreated?: string;
}

interface CustomerOrder {
    id: string;
    number: string;
    status: string;
    total: number;
    dateCreated: string;
}

interface CustomerDetails {
    customer: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        totalSpent: number;
        ordersCount: number;
        dateCreated: string;
        rawData?: {
            billing?: {
                phone?: string;
                address_1?: string;
                city?: string;
                state?: string;
                postcode?: string;
                country?: string;
            };
        };
    };
    orders: CustomerOrder[];
    activity: { id: string; type: string; message: string; timestamp: string }[];
}

/**
 * MobileCustomerDetail - Mobile-optimized customer profile page
 * Shows customer info, stats, and recent orders
 */
export function MobileCustomerDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<CustomerDetails | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (id) fetchCustomer();
        const handleRefresh = () => { if (id) fetchCustomer(); };
        window.addEventListener('mobile-refresh', handleRefresh);
        return () => window.removeEventListener('mobile-refresh', handleRefresh);
    }, [id, currentAccount, token]);

    const fetchCustomer = async () => {
        if (!currentAccount || !token || !id) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const res = await fetch(`/api/customers/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const json = await res.json();
                // Map API response to our expected shape
                // API returns: { customer, orders (raw WooOrders), automations, activity }
                const mappedData: CustomerDetails = {
                    customer: {
                        id: json.customer?.id || id,
                        firstName: json.customer?.firstName || '',
                        lastName: json.customer?.lastName || '',
                        email: json.customer?.email || '',
                        totalSpent: Number(json.customer?.totalSpent) || 0,
                        ordersCount: json.customer?.ordersCount || 0,
                        dateCreated: json.customer?.dateCreated || json.customer?.createdAt || '',
                        rawData: json.customer?.rawData
                    },
                    orders: (json.orders || []).map((order: OrderApiResponse) => ({
                        id: order.id,
                        number: order.rawData?.number || order.wooId || order.id,
                        status: order.rawData?.status || order.status || 'unknown',
                        total: Number(order.rawData?.total || order.total) || 0,
                        dateCreated: order.rawData?.date_created || order.dateCreated || ''
                    })),
                    activity: json.activity || []
                };
                setData(mappedData);
            }
        } catch (error) {
            Logger.error('[MobileCustomerDetail] Error:', { error: error });
        } finally {
            setLoading(false);
        }
    };

    // Currency formatting helper using centralized utility
    const formatAccountCurrency = (amount: number) =>
        formatCurrency(amount, currentAccount?.currency || 'USD');

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/3" />
                <div className="h-32 bg-gray-200 rounded-xl" />
                <div className="grid grid-cols-2 gap-3">
                    <div className="h-24 bg-gray-200 rounded-xl" />
                    <div className="h-24 bg-gray-200 rounded-xl" />
                </div>
                {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
            </div>
        );
    }

    if (!data) {
        return (
            <div className="text-center py-16">
                <ShoppingBag className="mx-auto text-gray-300 mb-4" size={48} />
                <p className="text-gray-500">Customer not found</p>
                <button onClick={() => navigate('/m/customers')} className="mt-4 text-indigo-600 font-medium">
                    Back to Customers
                </button>
            </div>
        );
    }

    const { customer, orders } = data;
    const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown';
    const initials = (customer.firstName?.[0] || '') + (customer.lastName?.[0] || '');
    const avgOrder = customer.ordersCount > 0 ? customer.totalSpent / customer.ordersCount : 0;

    return (
        <div className="space-y-4 pb-8">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button onClick={() => navigate('/m/customers')} className="p-2 -ml-2 rounded-lg active:bg-gray-100">
                    <ArrowLeft size={24} className="text-gray-700" />
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-gray-900">{fullName}</h1>
                    <p className="text-sm text-gray-500">Customer Profile</p>
                </div>
                <button onClick={fetchCustomer} className="p-2 rounded-full hover:bg-gray-100">
                    <RefreshCw size={20} className="text-gray-600" />
                </button>
            </div>

            {/* Profile Card */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                <div className="flex items-center gap-4 mb-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl">
                        {initials || '?'}
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-semibold text-gray-900">{fullName}</h2>
                        <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                            <Calendar size={14} />
                            <span>Customer since {formatDate(customer.dateCreated)}</span>
                        </div>
                    </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-2 pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-3 text-sm">
                        <Mail size={16} className="text-gray-400" />
                        <a href={`mailto:${customer.email}`} className="text-indigo-600">{customer.email}</a>
                    </div>
                    {customer.rawData?.billing?.phone && (
                        <div className="flex items-center gap-3 text-sm">
                            <Phone size={16} className="text-gray-400" />
                            <a href={`tel:${customer.rawData.billing.phone}`} className="text-indigo-600">
                                {customer.rawData.billing.phone}
                            </a>
                        </div>
                    )}
                    {customer.rawData?.billing?.city && (
                        <div className="flex items-center gap-3 text-sm">
                            <MapPin size={16} className="text-gray-400" />
                            <span className="text-gray-700">
                                {customer.rawData.billing.city}, {customer.rawData.billing.state} {customer.rawData.billing.country}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-3 border border-green-100">
                    <div className="flex items-center gap-1 text-green-600 mb-1">
                        <DollarSign size={14} />
                        <span className="text-xs font-medium">Total</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{formatAccountCurrency(customer.totalSpent)}</p>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-3 border border-indigo-100">
                    <div className="flex items-center gap-1 text-indigo-600 mb-1">
                        <Package size={14} />
                        <span className="text-xs font-medium">Orders</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{customer.ordersCount}</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-3 border border-amber-100">
                    <div className="flex items-center gap-1 text-amber-600 mb-1">
                        <ShoppingBag size={14} />
                        <span className="text-xs font-medium">AOV</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{formatAccountCurrency(avgOrder)}</p>
                </div>
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <h2 className="font-semibold text-gray-900 p-4 border-b border-gray-100">
                    Recent Orders ({orders.length})
                </h2>
                <div className="divide-y divide-gray-100">
                    {orders.length > 0 ? (
                        orders.slice(0, 10).map((order) => (
                            <button
                                key={order.id}
                                onClick={() => navigate(`/m/orders/${order.id}`)}
                                className="w-full p-4 flex items-center gap-3 text-left active:bg-gray-50"
                            >
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                                    <Package size={18} className="text-gray-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900">Order #{order.number}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase ${getStatusColor(order.status)}`}>
                                            {order.status}
                                        </span>
                                        <span className="text-xs text-gray-500">{formatDate(order.dateCreated)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-900">{formatAccountCurrency(order.total)}</span>
                                    <ChevronRight size={18} className="text-gray-400" />
                                </div>
                            </button>
                        ))
                    ) : (
                        <div className="p-8 text-center text-gray-400">
                            No orders found
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
