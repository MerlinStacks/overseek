import { useState, useMemo } from 'react';
import { Loader2, Search } from 'lucide-react';

interface ReportsTableProps {
    data: any[];
    loading: boolean;
    activeView: string;
}

export const ReportsTable = ({ data, loading, activeView }: ReportsTableProps) => {
    const [pageFilter, setPageFilter] = useState('');

    // Dynamic Columns based on View
    const isChannels = activeView === 'channels';
    const isCampaigns = activeView === 'campaigns';
    const isPages = activeView === 'pages' || activeView === 'entry' || activeView === 'exit';
    const isSearch = activeView === 'search';

    // Memoized filtered data for pages view
    const filteredData = useMemo(() => {
        if (!isPages || !pageFilter.trim()) return data;
        const lowerFilter = pageFilter.toLowerCase();
        return data.filter(row =>
            row.url?.toLowerCase().includes(lowerFilter) ||
            row.title?.toLowerCase().includes(lowerFilter)
        );
    }, [data, pageFilter, isPages]);

    if (loading) return <div className="p-12 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto text-blue-500" /></div>;

    const columnCount = () => {
        if (isChannels || isSearch) return 2;
        if (isPages) return activeView === 'pages' ? 3 : 2;
        if (isCampaigns) return 3;
        return 2;
    };

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
                                {filteredData.length} of {data.length}
                            </span>
                        )}
                    </div>
                </div>
            )}
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
                    <tr>
                        {isChannels && <><th className="p-4">Channel</th><th className="p-4 text-right">Sessions</th></>}
                        {isCampaigns && <><th className="p-4">Source / Medium</th><th className="p-4">Campaign</th><th className="p-4 text-right">Sessions</th></>}
                        {isPages && <><th className="p-4">Page URL</th>{activeView === 'pages' && <th className="p-4">Title</th>}<th className="p-4 text-right">{activeView === 'pages' ? 'Views' : activeView === 'entry' ? 'Entries' : 'Exits'}</th></>}
                        {isSearch && <><th className="p-4">Search Term</th><th className="p-4 text-right">Searches</th></>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {filteredData.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                            {isChannels && <><td className="p-4 font-medium">{row.channel}</td><td className="p-4 text-right">{row.sessions}</td></>}
                            {isCampaigns && <><td className="p-4 font-medium">{row.source} / {row.medium}</td><td className="p-4">{row.campaign}</td><td className="p-4 text-right">{row.sessions}</td></>}
                            {isPages && <><td className="p-4 font-medium text-blue-600 truncate max-w-sm" title={row.url}>{row.url}</td>{activeView === 'pages' && <td className="p-4 text-gray-500 truncate max-w-xs">{row.title}</td>}<td className="p-4 text-right">{row.views || row.entries || row.exits}</td></>}
                            {isSearch && <><td className="p-4 font-medium">"{row.term}"</td><td className="p-4 text-right">{row.searches}</td></>}
                        </tr>
                    ))}
                    {filteredData.length === 0 && <tr><td colSpan={columnCount()} className="p-8 text-center text-gray-500">{pageFilter ? 'No pages match your filter.' : 'No data found for this period.'}</td></tr>}
                </tbody>
            </table>
        </div>
    );
};
