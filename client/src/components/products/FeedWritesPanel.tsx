import { useState } from 'react';
import { Check, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import {
    formatFeedFieldLabel,
    getFeedOverrideKey,
    isProductFeedWriteField,
    type FeedChannel,
    type FeedWriteRow,
    type ProductFeedRowsResponse,
} from './feedWrites';

const CHANNELS: Array<{ id: FeedChannel; label: string }> = [
    { id: 'google', label: 'Google' },
    { id: 'meta', label: 'Meta' },
    { id: 'pinterest', label: 'Pinterest' },
    { id: 'similar', label: 'Similar' },
];

interface GoogleProductCategoryOption {
    id: string;
    path: string;
}

interface FeedWritesPanelProps {
    productWooId: number;
}

export function FeedWritesPanel({ productWooId }: FeedWritesPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const [activeChannel, setActiveChannel] = useState<FeedChannel>('google');
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
    const [optimizingKey, setOptimizingKey] = useState<string | null>(null);

    const headers = {
        Authorization: `Bearer ${token}`,
        'x-account-id': currentAccount?.id || '',
        'Content-Type': 'application/json',
    };

    const { data, isLoading, error, refetch } = useApiQuery<ProductFeedRowsResponse>({
        queryKey: ['product-feed-writes', currentAccount?.id, productWooId, activeChannel],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const response = await fetch(`/api/feeds/${activeChannel}/products/${productWooId}`, { headers });
            const body = await response.json();
            if (!response.ok) throw new Error(body?.error || 'Failed to load feed writes');
            return body;
        },
        refetchOnWindowFocus: false,
    });

    const { data: googleCategoriesData, isLoading: googleCategoriesLoading } = useApiQuery<{ options: GoogleProductCategoryOption[] }>({
        queryKey: ['google-product-categories', currentAccount?.id],
        enabled: !!token && !!currentAccount?.id,
        queryFn: async () => {
            const response = await fetch('/api/feeds/google-product-categories/options', { headers });
            const body = await response.json();
            if (!response.ok) throw new Error(body?.error || 'Failed to load Google product categories');
            return body;
        },
        staleTime: 24 * 60 * 60 * 1000,
    });

    const googleCategories = googleCategoriesData?.options || [];
    const googleCategoryIds = new Set(googleCategories.map((option) => option.id));

    const { mutateAsync: saveWrites, isPending: isSaving } = useApiMutation<
        { success: boolean },
        { fields: Record<string, string | null> }
    >({
        mutationFn: async ({ fields }) => {
            const response = await fetch(`/api/feeds/${activeChannel}/rows/${productWooId}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ fields }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body?.error || 'Failed to save feed writes');
            return body;
        },
    });

    const { mutateAsync: optimizeField } = useApiMutation<
        { success: boolean; suggestions?: Record<string, string> },
        { row: FeedWriteRow; field: string }
    >({
        mutationFn: async ({ row, field }) => {
            const response = await fetch(`/api/feeds/${activeChannel}/rows/${productWooId}/optimize`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ fields: [field], variationWooId: row.variationWooId }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body?.error || `Failed to rewrite ${field}`);
            return body;
        },
    });

    const updateDraft = (row: FeedWriteRow, field: string, value: string) => {
        const draftKey = `${row.rowId}:${field}`;
        setDrafts((current) => ({ ...current, [draftKey]: value }));
        setDirtyKeys((current) => new Set(current).add(draftKey));
    };

    const getGoogleCategoryId = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return '';
        if (googleCategoryIds.has(trimmed)) return trimmed;

        const idMatch = trimmed.match(/^(\d+)\s+-\s+/);
        if (idMatch && googleCategoryIds.has(idMatch[1])) return idMatch[1];

        return googleCategories.find((option) => option.path === trimmed)?.id || '';
    };

    const handleAiRewrite = async (row: FeedWriteRow, field: string) => {
        const fieldKey = `${row.rowId}:${field}`;
        setOptimizingKey(fieldKey);
        try {
            const result = await optimizeField({ row, field });
            const suggestion = result.suggestions?.[field]?.trim();
            if (!suggestion) throw new Error(`AI did not return a ${field} rewrite`);
            updateDraft(row, field, suggestion);
            toast.success(`${formatFeedFieldLabel(field)} rewritten with AI.`);
        } catch (rewriteError: any) {
            toast.error(rewriteError?.message || `Failed to rewrite ${field}`);
        } finally {
            setOptimizingKey(null);
        }
    };

    const handleSave = async () => {
        if (!data || dirtyKeys.size === 0) return;

        const fields: Record<string, string | null> = {};
        data.rows.forEach((row) => {
            row.columns.forEach((column) => {
                const draftKey = `${row.rowId}:${column.targetField}`;
                if (!dirtyKeys.has(draftKey)) return;
                let value = drafts[draftKey]?.trim() || '';
                if (column.targetField === 'google_product_category' && value) {
                    value = getGoogleCategoryId(value);
                    if (!value) return;
                }
                fields[getFeedOverrideKey(row, column.targetField)] = value || null;
            });
        });

        const hasInvalidGoogleCategory = data.rows.some((row) => row.columns.some((column) => {
            const draftKey = `${row.rowId}:${column.targetField}`;
            return column.targetField === 'google_product_category'
                && dirtyKeys.has(draftKey)
                && !!drafts[draftKey]?.trim()
                && !getGoogleCategoryId(drafts[draftKey]);
        }));
        if (hasInvalidGoogleCategory) {
            toast.error('Please choose an official Google product category from the dropdown.');
            return;
        }

        try {
            await saveWrites({ fields });
            setDrafts({});
            setDirtyKeys(new Set());
            await refetch();
            toast.success(`${CHANNELS.find((channel) => channel.id === activeChannel)?.label} feed writes saved.`);
        } catch (saveError: any) {
            toast.error(saveError?.message || 'Failed to save feed writes');
        }
    };

    const rows = data?.rows || [];

    const handleChannelChange = (channel: FeedChannel) => {
        if (channel === activeChannel) return;
        if (dirtyKeys.size > 0 && !window.confirm('Discard unsaved feed writes and change channel?')) return;
        setDrafts({});
        setDirtyKeys(new Set());
        setActiveChannel(channel);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="rounded-xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Feed Writes</h2>
                        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
                            Override the matched feed fields for this product. Empty custom writes use the value matched on the Feeds page.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={dirtyKeys.size === 0 || isSaving}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {isSaving ? 'Saving...' : 'Save Feed Writes'}
                    </button>
                </div>

                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                    {CHANNELS.map((channel) => (
                        <button
                            key={channel.id}
                            type="button"
                            onClick={() => handleChannelChange(channel.id)}
                            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeChannel === channel.id
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                            }`}
                        >
                            {channel.label}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading && (
                <div className="flex min-h-48 items-center justify-center rounded-xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-800/80">
                    <Loader2 className="animate-spin text-indigo-600" size={28} />
                </div>
            )}

            {error && !isLoading && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                    {error.message}
                </div>
            )}

            {!isLoading && !error && rows.map((row) => {
                const columns = row.columns.filter((column) => isProductFeedWriteField(column.targetField));
                return (
                    <section key={row.rowId} className="rounded-xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-4 dark:border-slate-700">
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white">{row.name}</h3>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {row.rowType === 'variation' ? 'Variation' : 'Product'}{row.sku ? ` · SKU ${row.sku}` : ''}
                                </p>
                            </div>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                <Check size={13} /> {columns.length} writable fields
                            </span>
                        </div>

                        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                            {columns.map((column) => {
                                const draftKey = `${row.rowId}:${column.targetField}`;
                                const value = drafts[draftKey] ?? column.overrideValue ?? '';
                                const isLongText = column.targetField === 'description' || value.length > 120;
                                const canAiRewrite = column.targetField === 'title' || column.targetField === 'description';
                                const isAiRewriting = optimizingKey === draftKey;
                                const inputClasses = `mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:bg-slate-900 dark:text-slate-100 ${column.isMissingRequired
                                    ? 'border-amber-400 dark:border-amber-600'
                                    : 'border-slate-300 dark:border-slate-600'
                                }`;

                                return (
                                    <div key={column.targetField} className="block min-w-0">
                                        <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                            <label htmlFor={draftKey}>{formatFeedFieldLabel(column.targetField)}</label>
                                            <span className="flex items-center gap-2">
                                                {column.isMissingRequired && <span className="text-xs text-amber-600 dark:text-amber-400">Required</span>}
                                                {canAiRewrite && (
                                                    <button
                                                        type="button"
                                                        disabled={!!optimizingKey}
                                                        onClick={() => handleAiRewrite(row, column.targetField)}
                                                        className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/50"
                                                    >
                                                        {isAiRewriting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                                        {isAiRewriting ? 'Rewriting...' : 'AI Rewrite'}
                                                    </button>
                                                )}
                                            </span>
                                        </span>
                                        {column.targetField === 'google_product_category' ? (
                                            <>
                                                <input
                                                    id={draftKey}
                                                    type="text"
                                                    list={`google-product-categories-${row.rowId}-${activeChannel}`}
                                                    value={value}
                                                    placeholder={googleCategoriesLoading ? 'Loading Google categories...' : 'Search Google category ID or name'}
                                                    disabled={googleCategoriesLoading || googleCategories.length === 0}
                                                    onChange={(event) => updateDraft(row, column.targetField, event.target.value)}
                                                    className={inputClasses}
                                                />
                                                <datalist id={`google-product-categories-${row.rowId}-${activeChannel}`}>
                                                    {googleCategories.map((option) => (
                                                        <option key={option.id} value={`${option.id} - ${option.path}`} />
                                                    ))}
                                                </datalist>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    Type to search official Google categories, then choose a result.
                                                </p>
                                            </>
                                        ) : isLongText ? (
                                            <textarea
                                                id={draftKey}
                                                rows={4}
                                                value={value}
                                                placeholder={column.aiSuggestedValue || column.mappedValue || 'No matched value'}
                                                onChange={(event) => updateDraft(row, column.targetField, event.target.value)}
                                                className={inputClasses}
                                            />
                                        ) : (
                                            <input
                                                id={draftKey}
                                                type="text"
                                                value={value}
                                                placeholder={column.aiSuggestedValue || column.mappedValue || 'No matched value'}
                                                onChange={(event) => updateDraft(row, column.targetField, event.target.value)}
                                                className={inputClasses}
                                            />
                                        )}
                                        <span className="mt-1 flex min-w-0 items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span className="truncate" title={column.mappedValue || undefined}>
                                                Matched: {column.mappedValue || 'None'}
                                            </span>
                                            {value && (
                                                <button
                                                    type="button"
                                                    onClick={() => updateDraft(row, column.targetField, '')}
                                                    className="inline-flex shrink-0 items-center gap-1 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                                                >
                                                    <RotateCcw size={12} /> Use matched
                                                </button>
                                            )}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
