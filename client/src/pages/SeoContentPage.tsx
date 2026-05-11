import { useEffect, useMemo, useState } from 'react';
import { FileText, Newspaper, ExternalLink, RefreshCw, Search, Edit3, ChevronLeft, ArrowUpDown } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { SeoAnalysisPanel, type SeoTest } from '../components/Seo/SeoAnalysisPanel';
import { calculateContentSeoScore } from '@overseek/core';

type Tab = 'pages' | 'posts';
type SortField = 'title' | 'status' | 'dateModified' | 'seoScore';
type SortDirection = 'asc' | 'desc';

interface ContentItem {
    id: string;
    wooId: number;
    title: string;
    slug: string | null;
    status: string | null;
    permalink: string | null;
    dateCreated: string;
    dateModified: string;
    content?: string;
    excerpt?: string;
    seoScore?: number;
    seoData?: { focusKeyword?: string; analysis?: SeoTest[] };
}


export function SeoContentPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const editId = searchParams.get('edit');
    const tab: Tab = tabParam === 'posts' ? 'posts' : 'pages';
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState<ContentItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<ContentItem | null>(null);
    const [editorLoading, setEditorLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ title: '', content: '', excerpt: '', focusKeyword: '' });
    const [contentView, setContentView] = useState<'code' | 'visual' | 'split'>('code');
    const [sortField, setSortField] = useState<SortField>('dateModified');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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
        if (tabParam !== 'pages' && tabParam !== 'posts') {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('tab', 'pages');
                return next;
            }, { replace: true });
        }
    }, [setSearchParams, tabParam]);

    useEffect(() => {
        fetchItems();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, token, currentAccount?.id]);

    useEffect(() => {
        const fetchEditorItem = async () => {
            if (!editId || !token || !currentAccount?.id) {
                setSelected(null);
                return;
            }
            setEditorLoading(true);
            setError(null);
            try {
                const detailEndpoint = tab === 'pages' ? `/api/content/pages/${editId}` : `/api/content/posts/${editId}`;
                const res = await fetch(detailEndpoint, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id,
                    }
                });
                if (!res.ok) throw new Error('Failed to load content details');
                const data = await res.json();
                setSelected(data);
                setForm({
                    title: data.title || '',
                    content: data.content || '',
                    excerpt: data.excerpt || '',
                    focusKeyword: data.seoData?.focusKeyword || '',
                });
                setContentView('split');
            } catch (e: any) {
                setError(e?.message || 'Failed to load content details');
            } finally {
                setEditorLoading(false);
            }
        };

        fetchEditorItem();
    }, [currentAccount?.id, editId, tab, token]);

    const liveSeoPreview = useMemo(() => {
        if (!selected) return { score: 0, tests: [] as SeoTest[] };
        const preview = calculateContentSeoScore({
            title: form.title,
            content: form.content,
            excerpt: form.excerpt,
            focusKeyword: form.focusKeyword,
            slug: selected.slug,
            permalink: selected.permalink,
        });
        return { score: preview.score, tests: preview.tests as SeoTest[] };
    }, [form.content, form.excerpt, form.focusKeyword, form.title, selected]);

    const openEditor = (item: ContentItem) => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('tab', tab);
            next.set('edit', item.id);
            return next;
        });
    };

    const closeEditor = () => {
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('tab', tab);
            next.delete('edit');
            return next;
        });
    };

    const saveEditor = async () => {
        if (!token || !currentAccount?.id || !selected) return;
        setSaving(true);
        try {
            const detailEndpoint = tab === 'pages' ? `/api/content/pages/${selected.id}` : `/api/content/posts/${selected.id}`;
            const res = await fetch(detailEndpoint, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                    'content-type': 'application/json',
                },
                body: JSON.stringify(form),
            });
            if (!res.ok) throw new Error('Failed to save content');
            const updated = await res.json();
            setSelected(updated);
            await fetchItems();
        } catch (e: any) {
            setError(e?.message || 'Failed to save content');
        } finally {
            setSaving(false);
        }
    };

    const sortedItems = useMemo(() => {
        const list = [...items];
        list.sort((a, b) => {
            let comparison = 0;
            if (sortField === 'title') comparison = (a.title || '').localeCompare(b.title || '');
            if (sortField === 'status') comparison = (a.status || '').localeCompare(b.status || '');
            if (sortField === 'dateModified') comparison = new Date(a.dateModified).getTime() - new Date(b.dateModified).getTime();
            if (sortField === 'seoScore') comparison = (a.seoScore ?? -1) - (b.seoScore ?? -1);
            return sortDirection === 'asc' ? comparison : -comparison;
        });
        return list;
    }, [items, sortDirection, sortField]);

    const toggleSort = (field: SortField) => {
        if (field === sortField) {
            setSortDirection((prev) => prev === 'asc' ? 'desc' : 'asc');
            return;
        }
        setSortField(field);
        setSortDirection('asc');
    };

    const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
        <button
            type="button"
            onClick={() => toggleSort(field)}
            className="inline-flex items-center gap-1 font-medium hover:text-blue-600 dark:hover:text-blue-300"
        >
            {label}
            <ArrowUpDown size={12} className={sortField === field ? 'text-blue-600 dark:text-blue-300' : 'text-slate-400'} />
        </button>
    );

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
                <button onClick={() => setSearchParams({ tab: 'pages' })} className={`px-3 py-2 rounded-lg text-sm ${tab === 'pages' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><FileText size={14} className="inline mr-1" />Pages</button>
                <button onClick={() => setSearchParams({ tab: 'posts' })} className={`px-3 py-2 rounded-lg text-sm ${tab === 'posts' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}><Newspaper size={14} className="inline mr-1" />Blog Posts</button>
                <div className="ml-auto relative">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchItems()} placeholder="Search title or slug" className="pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
            </div>

            {editId ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 lg:p-6 space-y-4">
                    <button onClick={closeEditor} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm">
                        <ChevronLeft size={14} /> Back to list
                    </button>
                    {editorLoading && <div className="p-4 text-sm text-slate-500">Loading content editor...</div>}
                    {!editorLoading && selected && (
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                            <div className="xl:col-span-2 space-y-4">
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Edit {tab === 'pages' ? 'Page' : 'Post'}</h2>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Title</label>
                                    <input value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Focus Keyword</label>
                                    <input value={form.focusKeyword} onChange={(e) => setForm((s) => ({ ...s, focusKeyword: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" placeholder="e.g. woocommerce seo tips" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Excerpt</label>
                                    <textarea value={form.excerpt} onChange={(e) => setForm((s) => ({ ...s, excerpt: e.target.value }))} rows={4} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                                </div>
                                <div>
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <label className="block text-sm font-medium">Content</label>
                                        <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => setContentView('code')}
                                                className={`px-3 py-1.5 text-xs ${contentView === 'code' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
                                            >
                                                Code
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setContentView('visual')}
                                                className={`px-3 py-1.5 text-xs border-l border-slate-300 dark:border-slate-700 ${contentView === 'visual' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
                                            >
                                                Visual
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setContentView('split')}
                                                className={`px-3 py-1.5 text-xs border-l border-slate-300 dark:border-slate-700 ${contentView === 'split' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
                                            >
                                                Split
                                            </button>
                                        </div>
                                    </div>
                                    {contentView === 'code' ? (
                                        <textarea value={form.content} onChange={(e) => setForm((s) => ({ ...s, content: e.target.value }))} rows={22} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                                    ) : contentView === 'visual' ? (
                                        <div className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[528px] max-h-[528px] overflow-y-auto p-4">
                                            {form.content.trim() ? (
                                                <div className="prose prose-slate max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: form.content }} />
                                            ) : (
                                                <p className="text-sm text-slate-500 dark:text-slate-400">No content to preview yet.</p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                            <textarea value={form.content} onChange={(e) => setForm((s) => ({ ...s, content: e.target.value }))} rows={22} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" />
                                            <div className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[528px] max-h-[528px] overflow-y-auto p-4">
                                                {form.content.trim() ? (
                                                    <div className="prose prose-slate max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: form.content }} />
                                                ) : (
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">No content to preview yet.</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button onClick={closeEditor} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800">Cancel</button>
                                    <button disabled={saving} onClick={saveEditor} className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Saving...' : 'Save changes'}</button>
                                </div>
                            </div>
                            <div>
                                <SeoAnalysisPanel
                                    score={liveSeoPreview.score}
                                    tests={liveSeoPreview.tests}
                                    focusKeyword={form.focusKeyword}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                {loading && <div className="p-4 text-sm text-slate-500">Loading...</div>}
                {error && <div className="p-4 text-sm text-red-600">{error}</div>}
                {!loading && !error && items.length === 0 && <div className="p-4 text-sm text-slate-500">No content found.</div>}
                {!loading && !error && items.length > 0 && (
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                                <th className="text-left px-4 py-2"><SortHeader field="title" label="Title" /></th>
                                <th className="text-left px-4 py-2"><SortHeader field="status" label="Status" /></th>
                                <th className="text-left px-4 py-2"><SortHeader field="dateModified" label="Updated" /></th>
                                <th className="text-left px-4 py-2"><SortHeader field="seoScore" label="SEO" /></th>
                                <th className="text-left px-4 py-2">Link</th>
                                <th className="text-left px-4 py-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedItems.map((item) => (
                                <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700">
                                    <td className="px-4 py-2">{item.title || '(untitled)'}</td>
                                    <td className="px-4 py-2 capitalize">{item.status || 'unknown'}</td>
                                    <td className="px-4 py-2">{new Date(item.dateModified).toLocaleString()}</td>
                                    <td className="px-4 py-2">{typeof item.seoScore === 'number' ? `${item.seoScore}/100` : '-'}</td>
                                    <td className="px-4 py-2">
                                        {item.permalink ? <a className="inline-flex items-center gap-1 text-blue-600" href={item.permalink} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a> : '-'}
                                    </td>
                                    <td className="px-4 py-2">
                                        <button onClick={() => openEditor(item)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
                                            <Edit3 size={12} /> Edit
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            )}
        </div>
    );
}
