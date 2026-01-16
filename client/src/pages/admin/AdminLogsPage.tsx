import { useEffect, useState } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { CheckCircle, XCircle, Clock, RotateCw } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Pagination } from '../../components/ui/Pagination';

interface SyncLog {
    id: string;
    accountId: string;
    account: { name: string };
    entityType: string;
    status: string;
    itemsProcessed: number;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
}

export function AdminLogsPage() {
    const { token } = useAuth();
    const [logs, setLogs] = useState<SyncLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [totalPages, setTotalPages] = useState(1);

    const fetchLogs = (currentPage: number, currentLimit: number) => {
        setLoading(true);
        fetch(`/api/admin/logs?page=${currentPage}&limit=${currentLimit}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => {
                setLogs(data.logs);
                setTotalPages(data.totalPages);
                setPage(data.page);
                setLoading(false);
            })
            .catch(err => {
                Logger.error('An error occurred', { error: err });
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchLogs(page, limit);
    }, [token, page, limit]); // Re-fetch when page changes

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-slate-800">System Logs</h1>
                <button
                    onClick={() => fetchLogs(page, limit)}
                    className="p-2 text-slate-500 hover:text-blue-600 transition-colors"
                >
                    <RotateCw size={20} />
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-100 uppercase text-xs text-slate-500 font-medium">
                            <tr>
                                <th className="p-4">Status</th>
                                <th className="p-4">Account</th>
                                <th className="p-4">Entity</th>
                                <th className="p-4">Time</th>
                                <th className="p-4">Details</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {logs.map(log => (
                                <tr key={log.id} className="hover:bg-slate-50/50">
                                    <td className="p-4">
                                        {log.status === 'SUCCESS' && <div className="flex items-center gap-2 text-green-600"><CheckCircle size={16} /> Success</div>}
                                        {log.status === 'FAILED' && <div className="flex items-center gap-2 text-red-600"><XCircle size={16} /> Failed</div>}
                                        {log.status === 'IN_PROGRESS' && <div className="flex items-center gap-2 text-blue-600"><Clock size={16} /> Running</div>}
                                    </td>
                                    <td className="p-4 font-medium text-slate-900">{log.account?.name || 'Unknown'}</td>
                                    <td className="p-4 capitalize">{log.entityType}</td>
                                    <td className="p-4 text-slate-500">
                                        {new Date(log.startedAt).toLocaleString()}
                                    </td>
                                    <td className="p-4">
                                        {log.status === 'FAILED' ? (
                                            <span className="text-red-500 max-w-xs truncate block" title={log.errorMessage || ''}>
                                                {log.errorMessage}
                                            </span>
                                        ) : (
                                            <span className="text-slate-500">{log.itemsProcessed} items</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {!loading && logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-400">No logs found</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    itemsPerPage={limit}
                    onItemsPerPageChange={(newLimit) => {
                        setLimit(newLimit);
                        setPage(1); // Reset to first page when limit changes
                    }}
                    allowItemsPerPage={true}
                />
            </div>
        </div>
    );
}
