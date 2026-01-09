
import { useEffect, useState } from 'react';
// Force reload
import { ArrowLeft, Mail, ShoppingBag, Calendar, Activity, Zap, ExternalLink, MessageCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

interface CustomerDetails {
    customer: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        totalSpent: number;
        ordersCount: number;
        dateCreated: string;
        rawData: any;
    };
    orders: any[];
    automations: any[];
    activity: any[];
}

export function CustomerDetailsPage() {
    const { id } = useParams();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<CustomerDetails | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'automations' | 'activity'>('overview');

    useEffect(() => {
        if (id && currentAccount && token) {
            fetchCustomerDetails();
        }
    }, [id, currentAccount, token]);

    async function fetchCustomerDetails() {
        if (!id) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/customers/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || ''
                }
            });
            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }

    if (isLoading) return <div className="p-8 text-center text-gray-500">Loading customer profile...</div>;
    if (!data) return <div className="p-8 text-center text-red-500">Customer not found</div>;

    const { customer, orders, automations, activity } = data;

    // Helper to get initials
    const initials = (customer.firstName?.[0] || '') + (customer.lastName?.[0] || '');

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-10">
            {/* Header */}
            <div>
                <Link to="/customers" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 mb-4">
                    <ArrowLeft size={16} className="mr-1" /> Back to Customers
                </Link>
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-2xl">
                            {initials}
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">{customer.firstName} {customer.lastName}</h1>
                            <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                                <span className="flex items-center gap-1"><Mail size={14} /> {customer.email}</span>
                                <span className="flex items-center gap-1"><Calendar size={14} /> Joined {new Date(customer.dateCreated).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {/* Placeholder generic actions */}
                        <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Edit Profile</button>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Total Spent</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">${Number(customer.totalSpent).toFixed(2)}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Orders</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{customer.ordersCount}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Average Order</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">${customer.ordersCount > 0 ? (Number(customer.totalSpent) / customer.ordersCount).toFixed(2) : '0.00'}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
                    <p className="text-sm font-medium text-gray-500">Last Active</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{activity[0] ? new Date(activity[0].lastActiveAt).toLocaleDateString() : 'N/A'}</p>
                </div>
            </div>

            {/* Content Tabs */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 min-h-[500px]">
                <div className="border-b border-gray-200 px-6 flex gap-6">
                    {(['overview', 'orders', 'automations', 'activity'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`py-4 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="p-6">
                    {activeTab === 'overview' && (
                        <div className="grid grid-cols-2 gap-8">
                            <div>
                                <h3 className="text-lg font-semibold mb-4 text-gray-900">Contact Information</h3>
                                <dl className="space-y-4">
                                    <div>
                                        <dt className="text-sm text-gray-500 mb-1">Email</dt>
                                        <dd className="font-medium">{customer.email}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-sm text-gray-500 mb-1">Phone</dt>
                                        <dd className="font-medium">{customer.rawData?.billing?.phone || 'N/A'}</dd>
                                    </div>
                                </dl>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-4 text-gray-900">Billing Address</h3>
                                <div className="text-gray-700 bg-gray-50 p-4 rounded-lg">
                                    {customer.rawData?.billing ? (
                                        <>
                                            <p>{customer.rawData.billing.address_1}</p>
                                            <p>{customer.rawData.billing.address_2}</p>
                                            <p>{customer.rawData.billing.city}, {customer.rawData.billing.state} {customer.rawData.billing.postcode}</p>
                                            <p>{customer.rawData.billing.country}</p>
                                        </>
                                    ) : (
                                        <p className="text-gray-400 italic">No address on file</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'orders' && (
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                                    <th className="pb-3">Order #</th>
                                    <th className="pb-3">Date</th>
                                    <th className="pb-3">Status</th>
                                    <th className="pb-3 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {orders.map(order => (
                                    <tr key={order.id} className="hover:bg-gray-50">
                                        <td className="py-4 font-medium text-blue-600">#{order.number}</td>
                                        <td className="py-4 text-gray-600">{new Date(order.dateCreated).toLocaleDateString()}</td>
                                        <td className="py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${order.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                order.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                {order.status}
                                            </span>
                                        </td>
                                        <td className="py-4 text-right font-medium">${Number(order.total).toFixed(2)}</td>
                                    </tr>
                                ))}
                                {orders.length === 0 && (
                                    <tr><td colSpan={4} className="py-8 text-center text-gray-400">No recent orders found</td></tr>
                                )}
                            </tbody>
                        </table>
                    )}

                    {activeTab === 'automations' && (
                        <div>
                            <div className="bg-blue-50 text-blue-700 p-4 rounded-lg mb-6 text-sm flex gap-2">
                                <Activity size={18} />
                                <span>Showing <strong>Marketing Automation</strong> history. Broadcast history is not currently linked to individual profiles.</span>
                            </div>
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                                        <th className="pb-3">Automation</th>
                                        <th className="pb-3">Status</th>
                                        <th className="pb-3">Enrolled At</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {automations.map(auto => (
                                        <tr key={auto.id} className="hover:bg-gray-50">
                                            <td className="py-4 font-medium flex items-center gap-2">
                                                <Zap size={16} className="text-amber-500" />
                                                {auto.automation?.name || 'Unknown Automation'}
                                            </td>
                                            <td className="py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${auto.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                                                    }`}>
                                                    {auto.status}
                                                </span>
                                            </td>
                                            <td className="py-4 text-gray-600">{new Date(auto.createdAt).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                    {automations.length === 0 && (
                                        <tr><td colSpan={3} className="py-8 text-center text-gray-400">No automation history</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {activeTab === 'activity' && (
                        <div>
                            <div className="space-y-6">
                                {activity.map(session => (
                                    <div key={session.id} className="flex gap-4">
                                        <div className="flex flex-col items-center">
                                            <div className="w-2 h-2 rounded-full bg-blue-400 mt-2"></div>
                                            <div className="w-0.5 h-full bg-gray-100 my-1"></div>
                                        </div>
                                        <div className="flex-1 pb-4">
                                            <div className="flex justify-between">
                                                <h4 className="font-semibold text-gray-900">Session on {new Date(session.lastActiveAt).toLocaleDateString()}</h4>
                                                <span className="text-xs text-gray-400">{new Date(session.lastActiveAt).toLocaleTimeString()}</span>
                                            </div>
                                            <p className="text-sm text-gray-500 mb-2">
                                                Referrer: {session.referrer || 'Direct'} • Device: {session.deviceType || 'Unknown'}
                                            </p>
                                            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                                                {session.events.map((event: any, idx: number) => (
                                                    <div key={idx} className="text-sm flex gap-2 items-start">
                                                        <span className="text-gray-400 min-w-[60px]">{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                        <span className={
                                                            event.type === 'purchase' ? 'text-green-600 font-medium' :
                                                                event.type === 'add_to_cart' ? 'text-blue-600 font-medium' :
                                                                    'text-gray-700'
                                                        }>
                                                            {event.type.replace(/_/g, ' ')}: {event.url}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {activity.length === 0 && (
                                    <div className="text-center text-gray-400 py-8">No live activity recorded</div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
