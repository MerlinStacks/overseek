import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Facebook, Globe, Instagram, Loader2, Music2, Search, Youtube } from 'lucide-react';
import { formatCurrency } from '../../utils/format';

interface ReportsTableProps {
    data: ReportsTableRow[];
    loading: boolean;
    activeView: string;
}

interface ReportsTableRow {
    channel?: string;
    sessions?: number;
    conversions?: number;
    exitRate?: number;
    domains?: string[];
    source?: string;
    medium?: string;
    campaign?: string;
    revenue?: number;
    url?: string;
    title?: string;
    views?: number;
    entries?: number;
    exits?: number;
    term?: string;
    searches?: number;
}

type SortKey = 'channel' | 'source' | 'campaign' | 'sessions' | 'conversions' | 'revenue' | 'exitRate' | 'url' | 'title' | 'views' | 'entries' | 'exits';
type SortDirection = 'asc' | 'desc';

function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
        </svg>
    );
}

const ChannelIcon = ({ channel }: { channel?: string }) => {
    const key = (channel || '').toLowerCase();
    const className = 'h-4 w-4';

    if (key.includes('facebook')) return <Facebook className={`${className} text-blue-600`} />;
    if (key.includes('instagram')) return <Instagram className={`${className} text-pink-600`} />;
    if (key.includes('google')) return <GoogleIcon className={`${className} text-blue-600`} />;
    if (key.includes('youtube')) return <Youtube className={`${className} text-red-600`} />;
    if (key.includes('tiktok')) return <Music2 className={`${className} text-slate-900`} />;
    if (key.includes('bing') || key.includes('yahoo') || key.includes('duckduckgo')) return <Search className={`${className} text-emerald-600`} />;

    return <Globe className={`${className} text-gray-500`} />;
};

export const ReportsTable = ({ data, loading, activeView }: ReportsTableProps) => {
    const [pageFilter, setPageFilter] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('sessions');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    // Dynamic Columns based on View
    const isChannels = activeView === 'channels';
    const isCampaigns = activeView === 'campaigns';
    const isPages = activeView === 'pages';
    const isSearch = activeView === 'search';

    useEffect(() => {
        if (isChannels && !['channel', 'sessions', 'conversions', 'exitRate'].includes(sortKey)) {
            setSortKey('sessions');
            setSortDirection('desc');
        }
        if (isCampaigns && !['source', 'campaign', 'sessions', 'conversions', 'revenue'].includes(sortKey)) {
            setSortKey('sessions');
            setSortDirection('desc');
        }
        if (isPages && !['url', 'title', 'views', 'entries', 'exits'].includes(sortKey)) {
            setSortKey('views');
            setSortDirection('desc');
        }
    }, [isCampaigns, isChannels, isPages, sortKey]);

    const setSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc');
            return;
        }

        setSortKey(key);
        setSortDirection(key === 'url' || key === 'title' || key === 'channel' || key === 'source' || key === 'campaign' ? 'asc' : 'desc');
    };

    const SortableHeader = ({ sort, align = 'left', children }: { sort: SortKey; align?: 'left' | 'right'; children: ReactNode }) => (
        <th className={`p-4 ${align === 'right' ? 'text-right' : ''}`}>
            <button
                type="button"
                onClick={() => setSort(sort)}
                className={`inline-flex items-center gap-1 font-medium hover:text-gray-900 ${align === 'right' ? 'justify-end' : ''}`}
            >
                {children}
                {sortKey === sort && (sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
            </button>
        </th>
    );

    // Memoized filtered and sorted data for sortable report views
    const visibleData = useMemo(() => {
        if (!isPages && !isChannels && !isCampaigns) return data;

        const rows = isPages && pageFilter.trim()
            ? data.filter(row => {
                const lowerFilter = pageFilter.toLowerCase();
                return row.url?.toLowerCase().includes(lowerFilter) ||
                    row.title?.toLowerCase().includes(lowerFilter);
            })
            : data;

        return [...rows].sort((a, b) => {
            const direction = sortDirection === 'asc' ? 1 : -1;
            const activeSortKey = isPages && ['channel', 'source', 'campaign', 'sessions', 'conversions', 'revenue', 'exitRate'].includes(sortKey) ? 'views' : sortKey;
            const channelSafeSortKey = isChannels && ['source', 'campaign', 'revenue', 'url', 'title', 'views', 'entries', 'exits'].includes(activeSortKey) ? 'sessions' : activeSortKey;
            const safeSortKey = isCampaigns && ['channel', 'exitRate', 'url', 'title', 'views', 'entries', 'exits'].includes(channelSafeSortKey) ? 'sessions' : channelSafeSortKey;

            if (safeSortKey === 'url' || safeSortKey === 'title' || safeSortKey === 'channel' || safeSortKey === 'source' || safeSortKey === 'campaign') {
                return String(a[safeSortKey] || '').localeCompare(String(b[safeSortKey] || '')) * direction;
            }

            return ((a[safeSortKey] || 0) - (b[safeSortKey] || 0)) * direction;
        });
    }, [data, pageFilter, isPages, isChannels, isCampaigns, sortKey, sortDirection]);

    if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto text-blue-500" /></div>;

    const columnCount = () => {
        if (isSearch) return 2;
        if (isChannels) return 4;
        if (isPages) return 5;
        if (isCampaigns) return 5;
        return 2;
    };

    const emptyMessage = isPages && pageFilter ? 'No pages match your filter.' : 'No data found for this period.';

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            {/* Search/Filter for Pages view */}
            {isPages && (
                <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Filter pages by URL or title..."
                            value={pageFilter}
                            onChange={e => setPageFilter(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm 
                                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                                       placeholder:text-gray-400 bg-white"
                        />
                        {pageFilter && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                                {visibleData.length} of {data.length}
                            </span>
                        )}
                    </div>
                </div>
            )}
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
                    <tr>
                        {isChannels && <><SortableHeader sort="channel">Channel</SortableHeader><SortableHeader sort="sessions" align="right">Sessions</SortableHeader><SortableHeader sort="conversions" align="right">Conversions</SortableHeader><SortableHeader sort="exitRate" align="right">Exit Rate</SortableHeader></>}
                        {isCampaigns && <><SortableHeader sort="source">Source / Medium</SortableHeader><SortableHeader sort="campaign">Campaign</SortableHeader><SortableHeader sort="sessions" align="right">Sessions</SortableHeader><SortableHeader sort="conversions" align="right">Conversions</SortableHeader><SortableHeader sort="revenue" align="right">Revenue</SortableHeader></>}
                        {isPages && <><SortableHeader sort="url">Page URL</SortableHeader><SortableHeader sort="title">Title</SortableHeader><SortableHeader sort="views" align="right">Views</SortableHeader><SortableHeader sort="entries" align="right">Entries</SortableHeader><SortableHeader sort="exits" align="right">Exits</SortableHeader></>}
                        {isSearch && <><th className="p-4">Search Term</th><th className="p-4 text-right">Searches</th></>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {visibleData.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                            {isChannels && <><td className="p-4 font-medium"><div className="flex items-center gap-2"><ChannelIcon channel={row.channel} /><span>{row.channel}</span>{row.domains && row.domains.length > 1 && <span className="text-xs font-normal text-gray-400" title={row.domains.join(', ')}>+{row.domains.length - 1}</span>}</div></td><td className="p-4 text-right">{row.sessions ?? 0}</td><td className="p-4 text-right">{row.conversions ?? 0}</td><td className="p-4 text-right">{(row.exitRate ?? 0).toFixed(2)}%</td></>}
                            {isCampaigns && <><td className="p-4 font-medium">{row.source} / {row.medium}</td><td className="p-4">{row.campaign}</td><td className="p-4 text-right">{row.sessions ?? 0}</td><td className="p-4 text-right">{row.conversions ?? 0}</td><td className="p-4 text-right">{formatCurrency(row.revenue ?? 0)}</td></>}
                            {isPages && <><td className="p-4 font-medium text-blue-600 truncate max-w-sm" title={row.url}>{row.url}</td><td className="p-4 text-gray-500 truncate max-w-xs">{row.title || 'Untitled'}</td><td className="p-4 text-right">{row.views ?? 0}</td><td className="p-4 text-right">{row.entries ?? 0}</td><td className="p-4 text-right">{row.exits ?? 0}</td></>}
                            {isSearch && <><td className="p-4 font-medium">"{row.term}"</td><td className="p-4 text-right">{row.searches}</td></>}
                        </tr>
                    ))}
                    {visibleData.length === 0 && <tr><td colSpan={columnCount()} className="p-8 text-center text-gray-500">{emptyMessage}</td></tr>}
                </tbody>
            </table>
        </div>
    );
};
