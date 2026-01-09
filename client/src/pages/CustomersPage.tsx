import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Search, Users, Loader2, Mail, ShoppingBag, Calendar } from 'lucide-react';
import { Pagination } from '../components/ui/Pagination';

interface Customer {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    totalSpent: number;
    ordersCount: number;
    dateCreated: string;
}

export function CustomersPage() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);

    const [debouncedQuery, setDebouncedQuery] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery);
            setPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        fetchCustomers();
    }, [currentAccount, token, debouncedQuery, page, limit]);

    async function fetchCustomers() {
        if (!currentAccount || !token) return;

        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString(),
                q: debouncedQuery
            });

            const res = await fetch(`/api/customers?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                setCustomers(data.customers);
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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-gray-900">Customers</h1>
                    <p className="text-sm text-gray-500">View and manage your customer base</p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    <button
                        onClick={() => navigate('/customers/segments')}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                    >
                        <Users size={16} />
                        Segments
                    </button>
                    <div className="relative flex-1 sm:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search customers..."
                            className="w-full sm:w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase text-gray-500 font-semibold">
                                <th className="px-3 md:px-6 py-3 md:py-4">Customer</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Contact</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Orders</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Total Spent</th>
                                <th className="px-3 md:px-6 py-3 md:py-4">Joined</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {isLoading ? (
                                <tr><td colSpan={5} className="p-12 text-center"><Loader2 className="animate-spin inline text-blue-600" /></td></tr>
                            ) : customers.length === 0 ? (
                                <tr><td colSpan={5} className="p-12 text-center text-gray-500 flex flex-col items-center gap-2">
                                    <Users size={48} className="text-gray-300" />
                                    <p>No customers found.</p>
                                </td></tr>
                            ) : (
                                customers.map((customer) => (
                                    <tr key={customer.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => {
                                        navigate(`/customers/${encodeURIComponent(customer.id)}`)
                                    }}>

                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">
                                                    {customer.firstName?.[0]}{customer.lastName?.[0]}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-gray-900">{customer.firstName} {customer.lastName}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <Mail size={14} />
                                                {customer.email}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <ShoppingBag size={14} />
                                                {customer.ordersCount} orders
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            ${customer.totalSpent?.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={14} />
                                                {new Date(customer.dateCreated).toLocaleDateString()}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {!isLoading && customers.length > 0 && (
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
        </div >
    );
}
