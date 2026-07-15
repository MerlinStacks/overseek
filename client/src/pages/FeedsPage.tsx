import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Cog, RefreshCw } from 'lucide-react';
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

interface FeedMapping {
    targetField: string;
    sourceField: string;
    fallbackSourceField?: string;
    required?: boolean;
}

interface FeedExportUrlsResponse {
    urls: Record<FeedChannel, string>;
}

interface GoogleProductCategoryOption {
    id: string;
    path: string;
}

const CHANNELS: FeedChannel[] = ['google', 'meta', 'pinterest', 'similar'];
const BULK_WARN_THRESHOLD = 1000;
const BULK_HIGH_WARN_THRESHOLD = 10000;
const FEEDS_UI_STATE_KEY = 'overseek:feeds:ui-state:v1';
const FEEDS_EDIT_DRAFT_KEY = 'overseek:feeds:edit-draft:v1';
const LOCKED_FEED_FIELDS = new Set(['id', 'mpn', 'sku']);
const MIN_FEED_COLUMN_WIDTH = 120;
const MAX_FEED_COLUMN_WIDTH = 720;
const SOURCE_FIELD_OPTIONS = [
    { value: 'wooId', label: 'Product ID' },
    { value: 'name', label: 'Product name' },
    { value: 'description', label: 'Description' },
    { value: 'short_description', label: 'Short description' },
    { value: 'permalink', label: 'Product URL' },
    { value: 'canonicalLink', label: 'Canonical URL' },
    { value: 'mainImage', label: 'Main image' },
    { value: 'additionalImages', label: 'Additional images' },
    { value: 'videoLink', label: 'Video URL' },
    { value: 'price', label: 'Price' },
    { value: 'salePrice', label: 'Sale price' },
    { value: 'stockStatus', label: 'Stock status' },
    { value: 'brand', label: 'Brand' },
    { value: 'condition', label: 'Condition' },
    { value: 'googleProductCategory', label: 'Google category' },
    { value: 'productType', label: 'Product type' },
    { value: 'gtin', label: 'GTIN' },
    { value: 'mpn', label: 'MPN / SKU' },
    { value: 'itemGroupId', label: 'Parent group ID' },
    { value: 'storeCode', label: 'Store code' },
    { value: 'identifierExists', label: 'Identifier exists' },
    { value: 'salePriceEffectiveDate', label: 'Sale price dates' },
];
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
    const [mappingDraft, setMappingDraft] = useState<FeedMapping[]>([]);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [isRefreshingFeed, setIsRefreshingFeed] = useState(false);

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

    const { data: googleProductCategoryData, isLoading: googleProductCategoriesLoading } = useApiQuery<{ options: GoogleProductCategoryOption[] }>({
        queryKey: ['google-product-categories', currentAccount?.id],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const res = await fetch('/api/feeds/google-product-categories/options', { headers });
            if (!res.ok) throw new Error('Failed to fetch Google product categories');
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

    const { data: mappingsData, isLoading: mappingsLoading, refetch: refetchMappings } = useApiQuery<{ channel: FeedChannel; mappings: FeedMapping[] }>({
        queryKey: ['feed-mappings', activeChannel, currentAccount?.id],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const res = await fetch(`/api/feeds/mappings/${activeChannel}`, { headers });
            if (!res.ok) throw new Error('Failed to fetch feed mappings');
            return res.json();
        },
    });

    const { mutateAsync: saveMappings, isPending: isSavingMappings } = useApiMutation<
        { channel: FeedChannel; mappings: FeedMapping[] },
        { mappings: FeedMapping[] }
    >({
        mutationFn: async (payload) => {
            const res = await fetch(`/api/feeds/mappings/${activeChannel}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Failed to save feed mappings');
            return data;
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

    const { data: feedUrlData, isLoading: feedUrlLoading } = useApiQuery<FeedExportUrlsResponse>({
        queryKey: ['feed-export-urls', currentAccount?.id],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const res = await fetch('/api/feeds/settings/urls', { headers });
            if (!res.ok) throw new Error('Failed to fetch feed URLs');
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

    const { mutateAsync: optimizeRow, isPending: isOptimizingRow } = useApiMutation<
        { success: boolean; suggestions?: Record<string, string> },
        { row: FeedRow; fields: string[] }
    >({
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
    const rows = useMemo(() => rowsData?.rows || [], [rowsData?.rows]);
    const mappings = useMemo(() => rowsData?.mappings || [], [rowsData?.mappings]);
    const googleProductCategories = useMemo(() => googleProductCategoryData?.options || [], [googleProductCategoryData?.options]);
    const googleProductCategoryIds = useMemo(() => new Set(googleProductCategories.map((option) => option.id)), [googleProductCategories]);
    const total = rowsData?.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const feedUrl = useMemo(() => {
        const baseUrl = feedUrlData?.urls?.[activeChannel];
        if (!baseUrl) return '';
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}variationMode=${encodeURIComponent(variationMode)}`;
    }, [activeChannel, feedUrlData?.urls, variationMode]);

    const getDefaultColumnWidth = (field: string) => {
        if (field === 'select') return 44;
        if (field === 'sku') return 160;
        if (field === 'description') return 420;
        if (field === 'title') return 280;
        return 220;
    };

    const getColumnWidth = (field: string) => columnWidths[field] || getDefaultColumnWidth(field);

    const startColumnResize = (field: string, startX: number) => {
        const startWidth = getColumnWidth(field);
        const originalCursor = document.body.style.cursor;
        const originalUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handlePointerMove = (event: PointerEvent) => {
            const nextWidth = Math.min(
                MAX_FEED_COLUMN_WIDTH,
                Math.max(MIN_FEED_COLUMN_WIDTH, startWidth + event.clientX - startX),
            );
            setColumnWidths((prev) => ({ ...prev, [field]: nextWidth }));
        };

        const handlePointerUp = () => {
            document.body.style.cursor = originalCursor;
            document.body.style.userSelect = originalUserSelect;
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    const resetColumnWidth = (field: string) => {
        setColumnWidths((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });
    };

    useEffect(() => {
        try {
            const raw = localStorage.getItem(FEEDS_UI_STATE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw) as Partial<{
                activeTab: FeedsViewTab;
                activeChannel: FeedChannel;
                variationMode: VariationMode;
                query: string;
                page: number;
                limit: number;
                columnWidths: Record<string, number>;
            }>;
            if (saved.activeTab === 'spreadsheet' || saved.activeTab === 'settings') setActiveTab(saved.activeTab);
            if (saved.activeChannel && CHANNELS.includes(saved.activeChannel)) setActiveChannel(saved.activeChannel);
            if (saved.variationMode && VARIATION_MODES.some((m) => m.value === saved.variationMode)) setVariationMode(saved.variationMode);
            if (typeof saved.query === 'string') setQuery(saved.query);
            if (typeof saved.limit === 'number' && [25, 50, 100, 200].includes(saved.limit)) setLimit(saved.limit);
            if (saved.columnWidths && typeof saved.columnWidths === 'object') {
                const nextWidths: Record<string, number> = {};
                Object.entries(saved.columnWidths).forEach(([field, width]) => {
                    if (typeof width === 'number' && Number.isFinite(width)) {
                        nextWidths[field] = Math.min(MAX_FEED_COLUMN_WIDTH, Math.max(MIN_FEED_COLUMN_WIDTH, width));
                    }
                });
                setColumnWidths(nextWidths);
            }
            if (typeof saved.page === 'number' && Number.isFinite(saved.page) && saved.page >= 1) {
                setPage(Math.floor(saved.page));
                setPageInput(String(Math.floor(saved.page)));
            }
        } catch {
            // no-op: invalid persisted state
        }
    }, []);

    useEffect(() => {
        const state = {
            activeTab,
            activeChannel,
            variationMode,
            query,
            page,
            limit,
            columnWidths,
        };
        localStorage.setItem(FEEDS_UI_STATE_KEY, JSON.stringify(state));
    }, [activeTab, activeChannel, variationMode, query, page, limit, columnWidths]);

    useEffect(() => {
        if (!editingCell) {
            localStorage.removeItem(FEEDS_EDIT_DRAFT_KEY);
            return;
        }

        const draft = {
            channel: editingCell.channel,
            rowId: editingCell.rowId,
            field: editingCell.field,
            value: editingValue,
        };
        localStorage.setItem(FEEDS_EDIT_DRAFT_KEY, JSON.stringify(draft));
    }, [editingCell, editingValue]);

    useEffect(() => {
        if (rows.length === 0 || editingCell) return;
        try {
            const raw = localStorage.getItem(FEEDS_EDIT_DRAFT_KEY);
            if (!raw) return;
            const draft = JSON.parse(raw) as Partial<{
                channel: FeedChannel;
                rowId: string;
                field: string;
                value: string;
            }>;
            if (!draft.channel || !draft.rowId || !draft.field) return;
            if (draft.channel !== activeChannel) return;

            const rowExists = rows.some((row) => row.rowId === draft.rowId);
            if (!rowExists) return;

            setEditingCell({ channel: draft.channel, rowId: draft.rowId, field: draft.field });
            setEditingValue(typeof draft.value === 'string' ? draft.value : '');
        } catch {
            // no-op: invalid persisted draft
        }
    }, [rows, activeChannel, editingCell]);

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

    useEffect(() => {
        setMappingDraft(mappingsData?.mappings || []);
    }, [mappingsData?.mappings]);

    const getColumn = (row: FeedRow, field: string) => row.columns.find((c) => c.targetField === field);
    const canAiOptimizeField = (field: string) => field === 'title' || field === 'description';
    const isLockedFeedField = (field: string) => LOCKED_FEED_FIELDS.has(field);

    const getGoogleProductCategoryValue = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return '';
        if (googleProductCategoryIds.has(trimmed)) return trimmed;

        const idMatch = trimmed.match(/^(\d+)\s+-\s+/);
        if (idMatch && googleProductCategoryIds.has(idMatch[1])) return idMatch[1];

        const pathMatch = googleProductCategories.find((option) => option.path === trimmed);
        return pathMatch?.id || trimmed;
    };

    const updateMappingDraft = (targetField: string, patch: Partial<FeedMapping>) => {
        setMappingDraft((current) => current.map((mapping) => (
            mapping.targetField === targetField ? { ...mapping, ...patch } : mapping
        )));
    };

    const startEditing = (row: FeedRow, field: string, value: string | null) => {
        if (isLockedFeedField(field)) return;
        setEditingCell({ channel: activeChannel, rowId: row.rowId, field });
        setEditingValue(field === 'google_product_category' ? getGoogleProductCategoryValue(value || '') : value || '');
    };

    const cancelEditing = () => {
        setEditingCell(null);
        setEditingValue('');
        localStorage.removeItem(FEEDS_EDIT_DRAFT_KEY);
    };

    const saveEditing = async (row: FeedRow, field: string) => {
        if (isLockedFeedField(field)) return;
        const value = field === 'google_product_category' ? getGoogleProductCategoryValue(editingValue) : editingValue;
        if (field === 'google_product_category' && value && !googleProductCategoryIds.has(value)) {
            throw new Error('Please select an official Google product category.');
        }
        await saveCellValue({ row, field, value });
        cancelEditing();
        await refetchRows();
    };

    const handleEditorKeyDown = async (
        event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
        row: FeedRow,
        field: string,
        isTextArea: boolean,
    ) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditing();
            return;
        }

        if (event.key === 'Enter') {
            if (isTextArea && event.shiftKey) return;
            event.preventDefault();
            try {
                await saveEditing(row, field);
                toast.success(`${field} saved.`);
            } catch (error: any) {
                toast.error(error?.message || `Failed to save ${field}`);
            }
        }
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

    const copyFeedUrl = async () => {
        if (!feedUrl) {
            toast.error('Feed URL not available yet.');
            return;
        }

        try {
            await navigator.clipboard.writeText(feedUrl);
            toast.success('Feed URL copied to clipboard.');
        } catch (_error) {
            toast.error('Could not copy feed URL.');
        }
    };

    const refreshFeed = async () => {
        setIsRefreshingFeed(true);
        try {
            await refetchRows();
            toast.success(`${activeChannel.charAt(0).toUpperCase() + activeChannel.slice(1)} feed refreshed.`);
        } finally {
            setIsRefreshingFeed(false);
        }
    };

    return (
        <div className="space-y-4 lg:h-[calc(100vh-7rem)] lg:min-h-0">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Feeds</h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Configure feed channel settings and refresh behavior.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={isRefreshingFeed || !currentAccount?.id}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
                        onClick={refreshFeed}
                    >
                        <RefreshCw size={16} className={isRefreshingFeed ? 'animate-spin' : ''} />
                        {isRefreshingFeed ? 'Refreshing...' : 'Refresh feed'}
                    </button>
                    {activeTab === 'settings' && (
                        <button
                            type="button"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-indigo-600 bg-indigo-600 text-white shadow-sm transition-colors"
                            onClick={() => setActiveTab('spreadsheet')}
                            title="Back to spreadsheet"
                            aria-label="Back to spreadsheet"
                            aria-pressed
                        >
                            <Cog size={18} />
                        </button>
                    )}
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

                    <div className="space-y-2">
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Feed URL ({activeChannel})</h2>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                            Copy this URL into your ad platform. It uses the variation mode selected above.
                        </p>
                        {feedUrlLoading ? (
                            <p className="text-sm text-slate-600 dark:text-slate-400">Loading feed URL...</p>
                        ) : (
                            <div className="flex flex-col md:flex-row gap-2 md:items-center">
                                <input
                                    type="text"
                                    readOnly
                                    value={feedUrl}
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm"
                                />
                                <button
                                    type="button"
                                    className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white disabled:opacity-50"
                                    onClick={copyFeedUrl}
                                    disabled={!feedUrl}
                                >
                                    Copy URL
                                </button>
                            </div>
                        )}
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

                    <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                            <div>
                                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Column mapping ({activeChannel})</h2>
                                <p className="text-xs text-slate-600 dark:text-slate-400">
                                    Choose which product data feeds each catalog field. Product ID and MPN/SKU are locked to protect identifiers.
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={isSavingMappings || mappingsLoading || mappingDraft.length === 0}
                                className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white disabled:opacity-50"
                                onClick={async () => {
                                    try {
                                        const saved = await saveMappings({ mappings: mappingDraft });
                                        setMappingDraft(saved.mappings);
                                        await refetchMappings();
                                        await refetchRows();
                                        toast.success('Feed mappings saved.');
                                    } catch (error: any) {
                                        toast.error(error?.message || 'Failed to save feed mappings');
                                    }
                                }}
                            >
                                Save mappings
                            </button>
                        </div>

                        {mappingsLoading ? (
                            <p className="text-sm text-slate-600 dark:text-slate-400">Loading mappings...</p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 dark:bg-slate-700/60">
                                        <tr>
                                            <th className="text-left py-2 px-3">Catalog field</th>
                                            <th className="text-left py-2 px-3">Source value</th>
                                            <th className="text-left py-2 px-3">Fallback</th>
                                            <th className="text-left py-2 px-3">Required</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mappingDraft.map((mapping) => {
                                            const locked = isLockedFeedField(mapping.targetField);
                                            return (
                                                <tr key={mapping.targetField} className="border-t border-slate-100 dark:border-slate-700/60">
                                                    <td className="py-2 px-3 font-mono text-xs text-slate-700 dark:text-slate-200">
                                                        {mapping.targetField}
                                                        {mapping.targetField === 'custom_label_0' ? (
                                                            <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-sans text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                                                                editable label
                                                            </span>
                                                        ) : null}
                                                        {locked ? (
                                                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-sans text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                                                locked
                                                            </span>
                                                        ) : null}
                                                    </td>
                                                    <td className="py-2 px-3">
                                                        <select
                                                            className="w-52 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 disabled:opacity-60"
                                                            value={mapping.sourceField}
                                                            disabled={locked}
                                                            onChange={(e) => updateMappingDraft(mapping.targetField, { sourceField: e.target.value })}
                                                        >
                                                            {SOURCE_FIELD_OPTIONS.map((option) => (
                                                                <option key={option.value} value={option.value}>{option.label}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="py-2 px-3">
                                                        <select
                                                            className="w-52 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 disabled:opacity-60"
                                                            value={mapping.fallbackSourceField || ''}
                                                            disabled={locked}
                                                            onChange={(e) => updateMappingDraft(mapping.targetField, { fallbackSourceField: e.target.value || undefined })}
                                                        >
                                                            <option value="">None</option>
                                                            {SOURCE_FIELD_OPTIONS.map((option) => (
                                                                <option key={option.value} value={option.value}>{option.label}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td className="py-2 px-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!mapping.required}
                                                            disabled={locked}
                                                            onChange={(e) => updateMappingDraft(mapping.targetField, { required: e.target.checked })}
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'spreadsheet' && (
            <div className="flex min-h-0 flex-col space-y-3 rounded-xl border border-slate-200/50 bg-white/80 p-3 shadow-lg backdrop-blur-lg dark:border-slate-700/50 dark:bg-slate-800/80 lg:h-[calc(100%-4.75rem)]">
                <div className="-mx-1 flex flex-wrap items-center gap-2 border-b border-slate-200/70 px-1 pb-2 dark:border-slate-700/70">
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
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        Variation Mode: {VARIATION_MODES.find((mode) => mode.value === variationMode)?.label || variationMode}
                    </span>
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
                            onClick={() => setActiveTab('settings')}
                            title="Feed settings"
                            aria-label="Feed settings"
                            aria-pressed={false}
                        >
                            <Cog size={18} />
                        </button>
                        <input
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search name or SKU"
                        />
                        {editingCell && (
                            <button
                                type="button"
                                className="px-3 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                                onClick={cancelEditing}
                            >
                                Cancel
                            </button>
                        )}
                        {editingCell && (
                            <button
                                type="button"
                                disabled={isSavingCell}
                                className="px-3 py-2 rounded-lg text-sm bg-indigo-600 text-white disabled:opacity-50"
                                onClick={async () => {
                                    const row = rows.find((r) => r.rowId === editingCell.rowId);
                                    if (!row) return;
                                    try {
                                        await saveEditing(row, editingCell.field);
                                        toast.success(`${editingCell.field} saved.`);
                                    } catch (error: any) {
                                        toast.error(error?.message || `Failed to save ${editingCell.field}`);
                                    }
                                }}
                            >
                                Save Changes
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
                    <div className="min-h-0 flex-1 overflow-auto">
                        <table className="min-w-full table-fixed text-sm">
                            <colgroup>
                                <col style={{ width: getColumnWidth('select') }} />
                                <col style={{ width: getColumnWidth('sku') }} />
                                {mappings.map((mapping) => (
                                    <col key={mapping.targetField} style={{ width: getColumnWidth(mapping.targetField) }} />
                                ))}
                            </colgroup>
                            <thead className="sticky top-0 z-10 bg-white shadow-sm dark:bg-slate-800">
                                <tr className="border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 pr-2 text-left">
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
                                    <th className="relative py-2 pr-5 text-left select-none">
                                        SKU
                                        <button
                                            type="button"
                                            className="absolute right-0 top-0 h-full w-3 cursor-col-resize touch-none border-r border-transparent hover:border-indigo-400 focus:border-indigo-500 focus:outline-hidden"
                                            aria-label="Resize SKU column"
                                            onPointerDown={(event) => {
                                                event.preventDefault();
                                                startColumnResize('sku', event.clientX);
                                            }}
                                            onDoubleClick={() => resetColumnWidth('sku')}
                                        />
                                    </th>
                                    {mappings.map((mapping) => (
                                        <th key={mapping.targetField} className="relative py-2 pr-5 text-left select-none whitespace-nowrap">
                                            {mapping.targetField}
                                            {mapping.required ? <span className="text-rose-500 ml-1">*</span> : null}
                                            <button
                                                type="button"
                                                className="absolute right-0 top-0 h-full w-3 cursor-col-resize touch-none border-r border-transparent hover:border-indigo-400 focus:border-indigo-500 focus:outline-hidden"
                                                aria-label={`Resize ${mapping.targetField} column`}
                                                onPointerDown={(event) => {
                                                    event.preventDefault();
                                                    startColumnResize(mapping.targetField, event.clientX);
                                                }}
                                                onDoubleClick={() => resetColumnWidth(mapping.targetField)}
                                            />
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
                                            <td className="truncate py-2 pr-3 text-slate-600 dark:text-slate-300" title={row.sku || '-'}>{row.sku || '-'}</td>
                                            {mappings.map((mapping) => {
                                                const field = mapping.targetField;
                                                const column = getColumn(row, field);
                                                const value = column?.finalValue || '';
                                                const isEditing =
                                                    editingCell?.channel === activeChannel
                                                    && editingCell?.rowId === row.rowId
                                                    && editingCell?.field === field;
                                                const locked = isLockedFeedField(field);
                                                const isLongText = field === 'description' || value.length > 120;
                                                const displayValue = value || '-';

                                                return (
                                                    <td key={`${row.rowId}-${field}`} className="py-2 pr-3 align-top">
                                                        {isEditing ? (
                                                            <div className="space-y-1">
                                                                {field === 'google_product_category' ? (
                                                                    <>
                                                                        <input
                                                                            className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                                                            value={editingValue}
                                                                            list={`google-product-categories-${row.rowId}`}
                                                                            placeholder={googleProductCategoriesLoading ? 'Loading Google categories...' : 'Search Google category ID or name'}
                                                                            disabled={googleProductCategoriesLoading || googleProductCategories.length === 0}
                                                                            onChange={(e) => setEditingValue(e.target.value)}
                                                                            onKeyDown={(e) => {
                                                                                void handleEditorKeyDown(e, row, field, false);
                                                                            }}
                                                                        />
                                                                        <datalist id={`google-product-categories-${row.rowId}`}>
                                                                            {googleProductCategories.map((option) => (
                                                                                <option key={option.id} value={`${option.id} - ${option.path}`} />
                                                                            ))}
                                                                        </datalist>
                                                                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                                                            Type to search official Google categories, then choose a result.
                                                                        </p>
                                                                    </>
                                                                ) : field === 'description' || value.length > 90 ? (
                                                                    <textarea
                                                                        className="w-full min-h-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                                                        value={editingValue}
                                                                        onChange={(e) => setEditingValue(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            void handleEditorKeyDown(e, row, field, true);
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <input
                                                                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                                                                        value={editingValue}
                                                                        onChange={(e) => setEditingValue(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            void handleEditorKeyDown(e, row, field, false);
                                                                        }}
                                                                    />
                                                                )}
                                                                {canAiOptimizeField(field) ? (
                                                                    <button
                                                                        type="button"
                                                                        disabled={isOptimizingRow}
                                                                        className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
                                                                        onClick={async () => {
                                                                            try {
                                                                                const data = await optimizeRow({ row, fields: [field] });
                                                                                const suggestion = data?.suggestions?.[field];
                                                                                if (typeof suggestion === 'string' && suggestion.trim()) {
                                                                                    setEditingValue(suggestion.trim());
                                                                                }
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
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                disabled={locked}
                                                                className={`text-left w-full ${isLongText ? 'truncate' : 'truncate'} ${locked ? 'cursor-not-allowed text-slate-500 dark:text-slate-400' : column?.isMissingRequired ? 'text-rose-600 dark:text-rose-400' : 'hover:underline'}`}
                                                                onClick={() => startEditing(row, field, value)}
                                                                onDoubleClick={() => {
                                                                    if (field === 'description') {
                                                                        setExpandedDescription({ rowName: row.name, value: value || '-' });
                                                                    }
                                                                }}
                                                                title={displayValue}
                                                            >
                                                                {displayValue}
                                                            </button>
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

                <div className="flex flex-col gap-3 border-t border-slate-200 pt-3 dark:border-slate-700 md:flex-row md:items-center md:justify-between">
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
