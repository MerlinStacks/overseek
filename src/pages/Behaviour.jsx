import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchVisitorLog } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { Eye, ArrowRight, ArrowLeft, Search, FileText, Globe, MousePointer2 } from 'lucide-react';
import { toast } from 'sonner';
import DateRangePicker from '../components/DateRangePicker';

const Behaviour = () => {
    const { settings } = useSettings();
    const [searchParams] = useSearchParams();
    // Date Filtering State
    const [dateRange, setDateRange] = useState({ label: 'Last 30 Days', days: 30 });
    const [compareMode, setCompareMode] = useState('none');

    const activeView = searchParams.get('view') || 'pages'; // 'pages', 'entry_pages', 'exit_pages', 'titles', 'site_search'

    const [visits, setVisits] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        if (!settings.storeUrl || !settings.consumerKey) return;
        setLoading(true);
        try {
            const data = await fetchVisitorLog(settings);
            setVisits(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error(error);
            toast.error("Failed to load behaviour data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [settings]);

    const { stats, prevStats, showCompare } = useMemo(() => {
        // 1. Date Ranges
        const now = new Date();
        const days = dateRange.days || 36500;
        const endCurrent = new Date(now);
        const startCurrent = new Date(now);
        startCurrent.setDate(now.getDate() - days);

        const endPrev = new Date(startCurrent);
        const startPrev = new Date(startCurrent);
        if (compareMode === 'year') {
            endPrev.setFullYear(endPrev.getFullYear() - 1);
            startPrev.setFullYear(startPrev.getFullYear() - 1);
        } else {
            startPrev.setDate(startPrev.getDate() - days);
        }

        // 2. Filter Visits
        const currentVisits = [];
        const prevPeriodVisits = [];

        visits.forEach(v => {
            const date = new Date(v.last_activity);
            if (date >= startCurrent && date <= endCurrent) currentVisits.push(v);
            else if (compareMode !== 'none' && date >= startPrev && date <= endPrev) prevPeriodVisits.push(v);
        });

        const computeStats = (dataset) => {
            const pages = {};
            const titles = {};
            const entries = {};
            const exits = {};
            const searches = {};

            const isPage = (url) => {
                if (!url) return false;
                try {
                    const pathname = new URL(url).pathname.toLowerCase();
                    const excluded = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.css', '.js', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.mp3', '.pdf', '.zip', '.rar', '.json', '.xml', '.ico'];
                    return !excluded.some(ext => pathname.endsWith(ext));
                } catch (e) { return false; }
            };

            dataset.forEach(visit => {
                const actions = visit.actions || [];
                const pageViews = actions.filter(a => a.type === 'page_view');

                if (pageViews.length > 0) {
                    // Entry Page
                    const entry = pageViews[0];
                    if (entry.url && isPage(entry.url)) {
                        if (!entries[entry.url]) entries[entry.url] = { count: 0, title: entry.title || 'Unknown' };
                        entries[entry.url].count++;
                    }

                    // Exit Page
                    const exit = pageViews[pageViews.length - 1];
                    if (exit.url && isPage(exit.url)) {
                        if (!exits[exit.url]) exits[exit.url] = { count: 0, title: exit.title || 'Unknown' };
                        exits[exit.url].count++;
                    }

                    // All Pages & Search
                    pageViews.forEach(pv => {
                        if (pv.url && isPage(pv.url)) {
                            if (!pages[pv.url]) pages[pv.url] = { count: 0, title: pv.title || 'Unknown', time: 0 };
                            pages[pv.url].count++;

                            // Check for search
                            try {
                                const urlObj = new URL(pv.url);
                                const query = urlObj.searchParams.get('s') || urlObj.searchParams.get('q');
                                if (query) {
                                    const qKey = query.toLowerCase();
                                    if (!searches[qKey]) searches[qKey] = { count: 0, query: query };
                                    searches[qKey].count++;
                                }
                            } catch (e) { }
                        }
                        if (pv.title) {
                            if (!titles[pv.title]) titles[pv.title] = { count: 0 };
                            titles[pv.title].count++;
                        }
                    });
                }
            });

            const sortDesc = (obj) => Object.entries(obj).map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.count - a.count);

            return {
                pages: sortDesc(pages),
                entries: sortDesc(entries),
                exits: sortDesc(exits),
                titles: sortDesc(titles),
                searches: sortDesc(searches)
            };
        };

        return {
            stats: computeStats(currentVisits),
            prevStats: computeStats(prevPeriodVisits),
            showCompare: compareMode !== 'none'
        };
    }, [visits, dateRange, compareMode]);

    // Comparison Helper
    const getChangeBadge = (currentVal, key, datasetName) => {
        if (!showCompare) return null;

        // Find previous value
        // We need to look up the same KEY in prevStats[datasetName]
        const prevItem = prevStats[datasetName].find(p => p.key === key);
        const prevVal = prevItem ? prevItem.count : 0;

        if (prevVal === 0) return currentVal > 0 ? <span style={{ fontSize: '0.75rem', color: '#10b981', marginLeft: '6px' }}>(New)</span> : null;

        const change = ((currentVal - prevVal) / prevVal) * 100;
        const color = change >= 0 ? '#10b981' : '#ef4444';
        const arrow = change >= 0 ? '↑' : '↓';

        return (
            <span style={{ fontSize: '0.75rem', color, marginLeft: '8px', padding: '2px 4px', background: `rgba(${change >= 0 ? 16 : 239}, ${change >= 0 ? 185 : 68}, ${change >= 0 ? 129 : 68}, 0.1)`, borderRadius: '4px' }}>
                {arrow} {Math.abs(change).toFixed(0)}%
            </span>
        );
    };

    const DataTable = ({ data, columns, datasetName, emptyMessage }) => (
        <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
            <table className="products-table">
                <thead>
                    <tr>
                        {columns.map((c, i) => <th key={i} style={c.style}>{c.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {data.length > 0 ? (
                        data.map((row, i) => (
                            <tr key={i}>
                                {columns.map((c, j) => (
                                    <td key={j} style={c.cellStyle}>
                                        {c.render ? c.render(row) : row[c.key]}
                                        {/* Render Comparison Badge if this column is the 'count' column */}
                                        {c.key === 'count' && getChangeBadge(row.count, row.key, datasetName)}
                                    </td>
                                ))}
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={columns.length} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                {emptyMessage}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );

    const getPath = (url) => {
        try {
            return new URL(url).pathname;
        } catch (e) { return url; }
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem', background: 'linear-gradient(to right, #f8fafc, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        {activeView === 'pages' && 'Visited Pages'}
                        {activeView === 'entry_pages' && 'Entry Pages'}
                        {activeView === 'exit_pages' && 'Exit Pages'}
                        {activeView === 'titles' && 'Page Titles'}
                        {activeView === 'site_search' && 'Site Search'}
                    </h1>
                    <p style={{ color: 'var(--text-muted)' }}>
                        {activeView === 'pages' ? 'Most distinct URLs visited.' :
                            activeView === 'entry_pages' ? 'First page of the session.' :
                                activeView === 'exit_pages' ? 'Last page of the session.' :
                                    activeView === 'titles' ? 'Grouped by page title tag.' :
                                        'Search queries performed by visitors.'}
                    </p>
                </div>
                <button
                    onClick={loadData}
                    className="btn"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)' }}
                >
                    <Eye size={18} /> Refresh
                </button>
                <div style={{ marginLeft: '10px' }}>
                    <DateRangePicker
                        range={dateRange}
                        onChange={setDateRange}
                        compareMode={compareMode}
                        onCompareChange={setCompareMode}
                    />
                </div>
            </div>

            {activeView === 'pages' && (
                <DataTable
                    datasetName="pages"
                    data={stats.pages}
                    columns={[
                        { label: 'Page URL', render: r => <a href={r.key} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>{getPath(r.key)}</a> },
                        { label: 'Page Title', key: 'title' },
                        { label: 'Views', key: 'count', style: { textAlign: 'right' }, cellStyle: { textAlign: 'right' } }
                    ]}
                    emptyMessage="No page views recorded yet."
                />
            )}

            {activeView === 'entry_pages' && (
                <DataTable
                    datasetName="entries"
                    data={stats.entries}
                    columns={[
                        { label: 'Entry URL', render: r => <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ArrowRight size={14} color="#10b981" /> {getPath(r.key)}</div> },
                        { label: 'Page Title', key: 'title' },
                        { label: 'Entrances', key: 'count', style: { textAlign: 'right' }, cellStyle: { textAlign: 'right' } }
                    ]}
                    emptyMessage="No entry data available."
                />
            )}

            {activeView === 'exit_pages' && (
                <DataTable
                    datasetName="exits"
                    data={stats.exits}
                    columns={[
                        { label: 'Exit URL', render: r => <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ArrowLeft size={14} color="#ef4444" /> {getPath(r.key)}</div> },
                        { label: 'Page Title', key: 'title' },
                        { label: 'Exits', key: 'count', style: { textAlign: 'right' }, cellStyle: { textAlign: 'right' } }
                    ]}
                    emptyMessage="No exit data available."
                />
            )}

            {activeView === 'titles' && (
                <DataTable
                    datasetName="titles"
                    data={stats.titles}
                    columns={[
                        { label: 'Page Title', render: r => <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><FileText size={14} /> {r.key}</div> },
                        { label: 'Views', key: 'count', style: { textAlign: 'right' }, cellStyle: { textAlign: 'right' } }
                    ]}
                    emptyMessage="No title data available."
                />
            )}

            {activeView === 'site_search' && (
                <DataTable
                    datasetName="searches"
                    data={stats.searches}
                    columns={[
                        { label: 'Search Query', render: r => <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Search size={14} /> "{r.query}"</div> },
                        { label: 'Searches', key: 'count', style: { textAlign: 'right' }, cellStyle: { textAlign: 'right' } }
                    ]}
                    emptyMessage="No site usage detected (looks for ?s= parameters)."
                />
            )}

        </div>
    );
};

export default Behaviour;
