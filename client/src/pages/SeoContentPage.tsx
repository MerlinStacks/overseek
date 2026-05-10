import { useEffect, useMemo, useState } from 'react';
import { FileText, Newspaper, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

type Tab = 'pages' | 'posts';

interface ContentItem {
    id: string;
    wooId: number;
    title: string;
    slug: string | null;
    status: string | null;
    permalink: string | null;
    dateCreated: string;
    dateModified: string;
}

export function SeoContentPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [tab, setTab] = useState<Tab>('pages');
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState<ContentItem[]>([]);
    const [error, setError] = useState<string | null>(null);

    const endpoint = useMemo(() => tab === 'pages' ? '/api/content/pages' : '/api/content/posts', [tab]);

    const fetchItems = async () => {
        if (!token || !currentAccount?.id) return;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (q.trim()) params.set('q', q.trim());
            params.set('limit', '50');
            const res = await fetch(`${endpoint}?${params.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                }
            });
            if (!res.ok) throw new Error('Failed to load content');
            const data = await res.json();
            setItems(data.items || []);
        } catch (e: any) {
            setError(e?.message || 'Failed to load content');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchItems();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, token, currentAccount?.id]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SEO Content</h1>
                    <p className="text-slate-500 dark:text-slate-400">Synced WordPress pages and blog posts for ranking and AI analysis.</p>
                </div>
                <button
                    onClick={fetchItems}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            <div className="flex items-center gap-2">
                <button onClick={() => setTab('pages')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'pages' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><FileText size={14} className="inline mr-1" />Pages</button>
                <button onClick={() => setTab('posts')} className={`px-3 py-2 rounded-lg text-sm ${tab === 'posts' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><Newspaper size={14} className="inline mr-1" />Blog Posts</button>
                <div className="ml-auto relative">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchItems()} placeholder="Search title or slug" className="pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                {loading && <div className="p-4 text-sm text-slate-500">Loading...</div>}
                {error && <div className="p-4 text-sm text-red-600">{error}</div>}
                {!loading && !error && items.length === 0 && <div className="p-4 text-sm text-slate-500">No content found.</div>}
                {!loading && !error && items.length > 0 && (
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                                <th className="text-left px-4 py-2">Title</th>
                                <th className="text-left px-4 py-2">Status</th>
                                <th className="text-left px-4 py-2">Updated</th>
                                <th className="text-left px-4 py-2">Link</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item) => (
                                <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700">
                                    <td className="px-4 py-2">{item.title || '(untitled)'}</td>
                                    <td className="px-4 py-2 capitalize">{item.status || 'unknown'}</td>
                                    <td className="px-4 py-2">{new Date(item.dateModified).toLocaleString()}</td>
                                    <td className="px-4 py-2">
                                        {item.permalink ? <a className="inline-flex items-center gap-1 text-blue-600" href={item.permalink} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a> : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
