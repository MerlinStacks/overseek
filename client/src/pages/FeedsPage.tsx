import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { useToast } from '../context/ToastContext';
import { useApiMutation, useApiQuery } from '../hooks/useApiQuery';

type FeedChannel = 'google' | 'meta' | 'pinterest' | 'similar';
type FeedsViewTab = 'spreadsheet' | 'settings';
type RefreshMode = 'manual' | 'auto_on_sync' | '1h' | '3h' | '12h' | '24h';
type VariationMode = 'variable_parent' | 'all_variations' | 'default_variation' | 'first_variation' | 'last_variation' | 'variable_and_variations';

interface FeedColumn {
    targetField: string;
    finalValue: string | null;
    mappedValue: string | null;
    aiSuggestedValue: string | null;
    overrideValue: string | null;
    isMissingRequired: boolean;
}

interface FeedRow {
    rowId: string;
    rowType: 'parent' | 'variation';
    wooId: number;
    variationWooId?: number;
    sku?: string | null;
    name: string;
    columns: FeedColumn[];
}

interface FeedRowsResponse {
    rows: FeedRow[];
    total: number;
    mappings: Array<{ targetField: string; required?: boolean }>;
}

const CHANNELS: FeedChannel[] = ['google', 'meta', 'pinterest', 'similar'];
const BULK_WARN_THRESHOLD = 1000;
const BULK_HIGH_WARN_THRESHOLD = 10000;
const VARIATION_MODES: { value: VariationMode; label: string }[] = [
    { value: 'all_variations', label: 'All Variations' },
    { value: 'variable_parent', label: 'Variable Products (Parent)' },
    { value: 'default_variation', label: 'Default Variation' },
    { value: 'first_variation', label: 'First Variation' },
    { value: 'last_variation', label: 'Last Variation' },
    { value: 'variable_and_variations', label: 'Variable + Variations' },
];

export function FeedsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const [activeChannel, setActiveChannel] = useState<FeedChannel>('google');
    const [activeTab, setActiveTab] = useState<FeedsViewTab>('spreadsheet');
    const [variationMode, setVariationMode] = useState<VariationMode>('all_variations');
    const [query, setQuery] = useState('');
    const [editingCell, setEditingCell] = useState<{ channel: FeedChannel; rowId: string; field: string } | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const [expandedDescription, setExpandedDescription] = useState<{ rowName: string; value: string } | null>(null);
    const [selectedRows, setSelectedRows] = useState<Record<string, { wooId: number; variationWooId?: number }>>({});
    const [bulkJobId, setBulkJobId] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(50);
    const [pageInput, setPageInput] = useState('1');
    const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);
    const [allMatchingSelected, setAllMatchingSelected] = useState(false);

    const headers = useMemo(() => ({
        'Authorization': `Bearer ${token}`,
        'x-account-id': currentAccount?.id || '',
        'Content-Type': 'application/json',
    }), [token, currentAccount?.id]);

    const { data: optionsData, isLoading: optionsLoading } = useApiQuery<{ options: RefreshMode[] }>({
        queryKey: ['feed-refresh-options'],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const res = await fetch('/api/feeds/refresh-modes/options', { headers });
            if (!res.ok) throw new Error('Failed to fetch refresh options');
            return res.json();
        },
    });

    const { data: refreshModeData, isLoading: refreshModeLoading, refetch } = useApiQuery<{ channel: FeedChannel; refreshMode: RefreshMode }>({
        queryKey: ['feed-refresh-mode', activeChannel, currentAccount?.id],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const res = await fetch(`/api/feeds/refresh-mode/${activeChannel}`, { headers });
            if (!res.ok) throw new Error('Failed to fetch refresh mode');
            return res.json();
        },
    });

    const { mutateAsync: saveRefreshMode, isPending: isSaving } = useApiMutation<
        { channel: FeedChannel; refreshMode: RefreshMode },
        { refreshMode: RefreshMode }
    >({
        mutationFn: async (payload) => {
            const res = await fetch(`/api/feeds/refresh-mode/${activeChannel}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to save refresh mode');
            return data;
        },
    });

    const { data: bulkLimitData, isLoading: bulkLimitLoading, refetch: refetchBulkLimit } = useApiQuery<{ maxBulkOptimizeRows: number }>({
        queryKey: ['feed-bulk-limit', currentAccount?.id],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const res = await fetch('/api/feeds/settings/bulk-limit', { headers });
            if (!res.ok) throw new Error('Failed to fetch bulk limit');
            return res.json();
        },
    });

    const { mutateAsync: saveBulkLimit, isPending: isSavingBulkLimit } = useApiMutation<
        { maxBulkOptimizeRows: number },
        { maxBulkOptimizeRows: number }
    >({
        mutationFn: async (payload) => {
            const res = await fetch('/api/feeds/settings/bulk-limit', {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to save bulk limit');
            return data;
        },
    });

    const {
        data: rowsData,
        isLoading: rowsLoading,
        refetch: refetchRows,
    } = useApiQuery<FeedRowsResponse>({
        queryKey: ['feed-rows', activeChannel, variationMode, query, page, limit, currentAccount?.id],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const params = new URLSearchParams({
                variationMode,
                q: query,
                page: String(page),
                limit: String(limit),
            });
            const res = await fetch(`/api/feeds/${activeChannel}/rows?${params.toString()}`, { headers });
            if (!res.ok) throw new Error('Failed to fetch feed rows');
            return res.json();
        },
    });

    const { mutateAsync: saveCellValue, isPending: isSavingCell } = useApiMutation<{ success: boolean }, { row: FeedRow; field: string; value: string }>({
        mutationFn: async ({ row, field, value }) => {
            const res = await fetch(`/api/feeds/${activeChannel}/rows/${row.wooId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    fields: row.variationWooId
                        ? { [`${row.wooId}-${row.variationWooId}:${field}`]: value }
                        : { [field]: value },
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to save field');
            return data;
        },
    });

    const { mutateAsync: optimizeRow, isPending: isOptimizingRow } = useApiMutation<{ success: boolean }, { row: FeedRow; fields: string[] }>({
        mutationFn: async ({ row, fields }) => {
            const res = await fetch(`/api/feeds/${activeChannel}/rows/${row.wooId}/optimize`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ fields, variationWooId: row.variationWooId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to optimize row');
            return data;
        },
    });

    const { mutateAsync: optimizeBulk, isPending: isOptimizingBulk } = useApiMutation<
        { success: boolean; queued: boolean; jobId: string },
        { fields: string[]; rows: Array<{ wooId: number; variationWooId?: number }> }
    >({
        mutationFn: async (payload) => {
            const res = await fetch(`/api/feeds/${activeChannel}/rows/optimize-bulk`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to queue bulk optimize');
            return data;
        },
    });

    const { data: bulkJobStatus, refetch: refetchBulkStatus } = useApiQuery<any>({
        queryKey: ['feed-bulk-job', activeChannel, bulkJobId],
        enabled: !!bulkJobId && !!token && !!currentAccount?.id,
        refetchInterval: 2500,
        queryFn: async () => {
            const res = await fetch(`/api/feeds/${activeChannel}/rows/optimize-bulk/${bulkJobId}`, { headers });
            if (!res.ok) throw new Error('Failed to fetch bulk job status');
            return res.json();
        },
    });

    const options = optionsData?.options || ['manual', 'auto_on_sync', '1h', '3h', '12h', '24h'];
    const selectedMode = refreshModeData?.refreshMode || 'manual';
    const maxBulkOptimizeRows = bulkLimitData?.maxBulkOptimizeRows || 5000;
    const rows = rowsData?.rows || [];
    const mappings = rowsData?.mappings || [];
    const total = rowsData?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    useEffect(() => {
        setPage(1);
        setPageInput('1');
        setSelectedRows({});
        setAllMatchingSelected(false);
        setEditingCell(null);
        setExpandedDescription(null);
    }, [activeChannel, variationMode, query]);

    useEffect(() => {
        setPageInput(String(page));
    }, [page]);

    const getColumn = (row: FeedRow, field: string) => row.columns.find((c) => c.targetField === field);
    const canAiOptimizeField = (field: string) => field === 'title' || field === 'description';

    const startEditing = (row: FeedRow, field: string, value: string | null) => {
        setEditingCell({ channel: activeChannel, rowId: row.rowId, field });
        setEditingValue(value || '');
    };

    const cancelEditing = () => {
        setEditingCell(null);
        setEditingValue('');
    };

    const saveEditing = async (row: FeedRow, field: string) => {
        await saveCellValue({ row, field, value: editingValue });
        cancelEditing();
        await refetchRows();
    };

    const toggleRowSelected = (row: FeedRow, checked: boolean) => {
        setSelectedRows((prev) => {
            const next = { ...prev };
            if (checked) next[row.rowId] = { wooId: row.wooId, variationWooId: row.variationWooId };
            else delete next[row.rowId];
            return next;
        });
    };

    const selectedCount = Object.keys(selectedRows).length;
    const allRowsSelected = rows.length > 0 && rows.every((row) => !!selectedRows[row.rowId]);

    const modeLabel = (mode: RefreshMode) => {
        if (mode === 'auto_on_sync') return 'Auto (on Woo updates)';
        if (mode === 'manual') return 'Manual';
        return `Every ${mode}`;
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Feeds</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Configure feed channel settings and refresh behavior.
                </p>
            </div>

            <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-2">
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === 'spreadsheet'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                        }`}
                        onClick={() => setActiveTab('spreadsheet')}
                    >
                        Spreadsheet
                    </button>
                    <button
                        type="button"
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === 'settings'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                        }`}
                        onClick={() => setActiveTab('settings')}
                    >
                        Feed Settings
                    </button>
                </div>
            </div>

            {activeTab === 'settings' && (
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-4 space-y-5">
                    <div className="space-y-2">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Platform</h2>
                        <div className="flex flex-wrap gap-2">
                            {CHANNELS.map((channel) => {
                                const active = activeChannel === channel;
                                return (
                                    <button
                                        key={channel}
                                        type="button"
                                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                            active
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                                        }`}
                                        onClick={() => setActiveChannel(channel)}
                                    >
                                        {channel.charAt(0).toUpperCase() + channel.slice(1)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Variation mode</h2>
                        <select
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm w-full md:w-auto"
                            value={variationMode}
                            onChange={(e) => setVariationMode(e.target.value as VariationMode)}
                        >
                            {VARIATION_MODES.map((mode) => (
                                <option key={mode.value} value={mode.value}>{mode.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-3">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                            Refresh mode ({activeChannel})
                        </h2>

                        {(optionsLoading || refreshModeLoading) && (
                            <p className="text-sm text-slate-600 dark:text-slate-400">Loading feed settings...</p>
                        )}

                        {!optionsLoading && !refreshModeLoading && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {options.map((mode) => {
                                    const active = selectedMode === mode;
                                    return (
                                        <button
                                            key={mode}
                                            type="button"
                                            disabled={isSaving}
                                            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                                                active
                                                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
                                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                                            }`}
                                            onClick={async () => {
                                                try {
                                                    await saveRefreshMode({ refreshMode: mode });
                                                    await refetch();
                                                    toast.success(`Refresh mode set to ${modeLabel(mode)}.`);
                                                } catch (error: any) {
                                                    toast.error(error?.message || 'Failed to save refresh mode');
                                                }
                                            }}
                                        >
                                            {modeLabel(mode as RefreshMode)}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Bulk optimize cap</h2>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                            Hard cap per bulk optimize job for this account.
                        </p>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={1}
                                max={200000}
                                defaultValue={maxBulkOptimizeRows}
                                className="w-40 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
                                id="bulk-cap-input"
                            />
                            <button
                                type="button"
                                disabled={isSavingBulkLimit || bulkLimitLoading}
                                className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white disabled:opacity-50"
                                onClick={async () => {
                                    const input = document.getElementById('bulk-cap-input') as HTMLInputElement | null;
                                    const value = Number(input?.value || maxBulkOptimizeRows);
                                    if (!Number.isFinite(value) || value < 1) {
                                        toast.error('Please enter a valid bulk limit.');
                                        return;
                                    }
                                    try {
                                        const saved = await saveBulkLimit({ maxBulkOptimizeRows: value });
                                        await refetchBulkLimit();
                                        toast.success(`Bulk cap set to ${saved.maxBulkOptimizeRows.toLocaleString()} rows.`);
                                    } catch (error: any) {
                                        toast.error(error?.message || 'Failed to save bulk cap');
                                    }
                                }}
                            >
                                Save cap
                            </button>
                            <span className="text-xs text-slate-500 dark:text-slate-400">Current: {maxBulkOptimizeRows.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'spreadsheet' && (
            <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                    {CHANNELS.map((channel) => {
                        const active = activeChannel === channel;
                        return (
                            <button
                                key={channel}
                                type="button"
                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    active
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                                }`}
                                onClick={() => setActiveChannel(channel)}
                            >
                                {channel.charAt(0).toUpperCase() + channel.slice(1)}
                            </button>
                        );
                    })}
                </div>
                <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-white/95 dark:bg-slate-800/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-slate-800/80 border-b border-slate-200/70 dark:border-slate-700/70 flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                        Platform: {activeChannel.charAt(0).toUpperCase() + activeChannel.slice(1)}
                    </span>
                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        Variation Mode: {VARIATION_MODES.find((mode) => mode.value === variationMode)?.label || variationMode}
                    </span>
                </div>
                <div className="flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">Page size</label>
                        <select
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
                            value={limit}
                            onChange={(e) => {
                                const next = Number(e.target.value);
                                setLimit(next);
                                setPage(1);
                                setPageInput('1');
                            }}
                        >
                            {[25, 50, 100, 200].map((size) => (
                                <option key={size} value={size}>{size}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search name or SKU"
                        />
                        <button
                            type="button"
                            className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                            onClick={async () => { await refetchRows(); }}
                        >
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={selectedCount === 0 || isOptimizingBulk}
                        className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white disabled:opacity-50"
                        onClick={async () => {
                            try {
                                const payloadRows = Object.values(selectedRows);
                                if (payloadRows.length >= BULK_HIGH_WARN_THRESHOLD) {
                                    const proceed = window.confirm(
                                        `You are about to optimize ${payloadRows.length.toLocaleString()} rows. This may take a long time and consume significant AI credits. Continue?`,
                                    );
                                    if (!proceed) return;
                                } else if (payloadRows.length >= BULK_WARN_THRESHOLD) {
                                    const proceed = window.confirm(
                                        `You selected ${payloadRows.length.toLocaleString()} rows. For best performance, consider narrowing filters or running in smaller batches. Continue anyway?`,
                                    );
                                    if (!proceed) return;
                                }
                                const data = await optimizeBulk({ fields: ['title', 'description'], rows: payloadRows });
                                setBulkJobId(data.jobId);
                                toast.success(`Queued bulk optimize for ${payloadRows.length} rows.`);
                            } catch (error: any) {
                                toast.error(error?.message || 'Failed to queue bulk optimize');
                            }
                        }}
                    >
                        Optimize Selected (Title + Description)
                    </button>
                    <button
                        type="button"
                        disabled={isSelectingAllMatching || rowsLoading || total === 0}
                        className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
                        onClick={async () => {
                            try {
                                setIsSelectingAllMatching(true);
                                const params = new URLSearchParams({
                                    variationMode,
                                    q: query,
                                });
                                const res = await fetch(`/api/feeds/${activeChannel}/row-refs?${params.toString()}`, { headers });
                                if (!res.ok) throw new Error('Failed to fetch matching row IDs');
                                const data = await res.json();
                                const refs = Array.isArray(data?.rows) ? data.rows : [];
                                const nextSelection: Record<string, { wooId: number; variationWooId?: number }> = {};

                                refs.forEach((row: { rowId: string; wooId: number; variationWooId?: number }) => {
                                    nextSelection[row.rowId] = { wooId: row.wooId, variationWooId: row.variationWooId };
                                });

                                setSelectedRows(nextSelection);
                                setAllMatchingSelected(true);
                                toast.success(`Selected ${Object.keys(nextSelection).length} matching rows across all pages.`);
                            } catch (error: any) {
                                toast.error(error?.message || 'Failed to select all matching rows');
                            } finally {
                                setIsSelectingAllMatching(false);
                            }
                        }}
                    >
                        Select All Matching
                    </button>
                    {allMatchingSelected && (
                        <button
                            type="button"
                            className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                            onClick={() => {
                                setSelectedRows({});
                                setAllMatchingSelected(false);
                            }}
                        >
                            Clear Selection
                        </button>
                    )}
                    <span className="text-xs text-slate-500 dark:text-slate-400">{selectedCount} selected</span>
                    {selectedCount >= BULK_WARN_THRESHOLD && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                            Large selection: consider smaller batches.
                        </span>
                    )}
                    {bulkJobId && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                            Job: {bulkJobStatus?.state || 'queued'}
                        </span>
                    )}
                    {bulkJobStatus?.state === 'completed' && (
                        <button
                            type="button"
                            className="px-2 py-1 rounded text-xs bg-slate-100 dark:bg-slate-700"
                            onClick={async () => {
                                await refetchBulkStatus();
                                await refetchRows();
                            }}
                        >
                            Apply latest results
                        </button>
                    )}
                </div>

                {rowsLoading ? (
                    <p className="text-sm text-slate-600 dark:text-slate-300">Loading feed rows...</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700">
                                    <th className="text-left py-2 pr-2">
                                        <input
                                            type="checkbox"
                                            checked={allRowsSelected}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                if (!checked && allMatchingSelected) setAllMatchingSelected(false);
                                                setSelectedRows((prev) => {
                                                    const next = { ...prev };
                                                    rows.forEach((row) => {
                                                        if (checked) next[row.rowId] = { wooId: row.wooId, variationWooId: row.variationWooId };
                                                        else delete next[row.rowId];
                                                    });
                                                    return next;
                                                });
                                            }}
                                        />
                                    </th>
                                    <th className="text-left py-2 pr-3">Product</th>
                                    <th className="text-left py-2 pr-3">SKU</th>
                                    {mappings.map((mapping) => (
                                        <th key={mapping.targetField} className="text-left py-2 pr-3 whitespace-nowrap">
                                            {mapping.targetField}
                                            {mapping.required ? <span className="text-rose-500 ml-1">*</span> : null}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => {
                                    return (
                                        <tr key={row.rowId} className="border-b border-slate-100 dark:border-slate-700/60 align-middle">
                                            <td className="py-2 pr-2">
                                                <input
                                                    type="checkbox"
                                                checked={!!selectedRows[row.rowId]}
                                                    onChange={(e) => {
                                                        if (!e.target.checked && allMatchingSelected) setAllMatchingSelected(false);
                                                        toggleRowSelected(row, e.target.checked);
                                                    }}
                                                />
                                            </td>
                                            <td className="py-2 pr-3">
                                                <div className="font-medium text-slate-900 dark:text-white">{row.name}</div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400">{row.rowType}</div>
                                            </td>
                                            <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{row.sku || '-'}</td>
                                            {mappings.map((mapping) => {
                                                const field = mapping.targetField;
                                                const column = getColumn(row, field);
                                                const value = column?.finalValue || '';
                                                const isEditing =
                                                    editingCell?.channel === activeChannel
                                                    && editingCell?.rowId === row.rowId
                                                    && editingCell?.field === field;
                                                const isLongText = field === 'description' || value.length > 120;
                                                const displayValue = value || '-';

                                                return (
                                                    <td key={`${row.rowId}-${field}`} className="py-2 pr-3 max-w-sm align-top">
                                                        {isEditing ? (
                                                            <div className="space-y-1">
                                                                {field === 'description' || value.length > 90 ? (
                                                                    <textarea
                                                                        className="w-full min-h-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                                                        value={editingValue}
                                                                        onChange={(e) => setEditingValue(e.target.value)}
                                                                    />
                                                                ) : (
                                                                    <input
                                                                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                                                        value={editingValue}
                                                                        onChange={(e) => setEditingValue(e.target.value)}
                                                                    />
                                                                )}
                                                                <div className="flex gap-1 flex-wrap">
                                                                    <button
                                                                        type="button"
                                                                        disabled={isSavingCell}
                                                                        className="px-2 py-1 text-xs rounded bg-indigo-600 text-white disabled:opacity-50"
                                                                        onClick={async () => {
                                                                            try {
                                                                                await saveEditing(row, field);
                                                                                toast.success(`${field} saved.`);
                                                                            } catch (error: any) {
                                                                                toast.error(error?.message || `Failed to save ${field}`);
                                                                            }
                                                                        }}
                                                                    >
                                                                        Save
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="px-2 py-1 text-xs rounded bg-slate-100 dark:bg-slate-700"
                                                                        onClick={cancelEditing}
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                    {canAiOptimizeField(field) ? (
                                                                        <button
                                                                            type="button"
                                                                            disabled={isOptimizingRow}
                                                                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
                                                                            onClick={async () => {
                                                                                try {
                                                                                    await optimizeRow({ row, fields: [field] });
                                                                                    await refetchRows();
                                                                                    toast.success(`AI suggestion updated for ${field}.`);
                                                                                } catch (error: any) {
                                                                                    toast.error(error?.message || `Failed to optimize ${field}`);
                                                                                }
                                                                            }}
                                                                        >
                                                                            AI Optimize
                                                                        </button>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-start gap-2">
                                                                <button
                                                                    type="button"
                                                                    className={`text-left ${isLongText ? 'line-clamp-2' : ''} ${column?.isMissingRequired ? 'text-rose-600 dark:text-rose-400' : 'hover:underline'}`}
                                                                    onClick={() => {
                                                                        if (field === 'description') {
                                                                            setExpandedDescription({ rowName: row.name, value: value || '-' });
                                                                            return;
                                                                        }
                                                                        startEditing(row, field, value);
                                                                    }}
                                                                    title={displayValue}
                                                                >
                                                                    {displayValue}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                                                                    onClick={() => startEditing(row, field, value)}
                                                                >
                                                                    Edit
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-t border-slate-200 dark:border-slate-700 pt-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        Showing page {page} of {totalPages} ({total} rows)
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            Prev
                        </button>
                        <button
                            type="button"
                            className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                            Next
                        </button>
                        <div className="flex items-center gap-1 ml-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">Go to page</span>
                            <input
                                type="number"
                                min={1}
                                max={totalPages}
                                value={pageInput}
                                onChange={(e) => setPageInput(e.target.value)}
                                className="w-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
                            />
                            <button
                                type="button"
                                className="px-2 py-1 rounded text-sm bg-indigo-600 text-white"
                                onClick={() => {
                                    const parsed = Number(pageInput);
                                    if (!Number.isFinite(parsed)) return;
                                    const nextPage = Math.min(totalPages, Math.max(1, Math.floor(parsed)));
                                    setPage(nextPage);
                                }}
                            >
                                Go
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            )}

            <Modal
                isOpen={!!expandedDescription}
                onClose={() => setExpandedDescription(null)}
                title={expandedDescription ? `Description: ${expandedDescription.rowName}` : 'Description'}
                maxWidth="max-w-4xl"
            >
                <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                    {expandedDescription?.value || '-'}
                </div>
            </Modal>
        </div>
    );
}
