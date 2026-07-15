import { useState } from 'react';
import { Check, Loader2, RotateCcw, Save } from 'lucide-react';
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

    const updateDraft = (row: FeedWriteRow, field: string, value: string) => {
        const draftKey = `${row.rowId}:${field}`;
        setDrafts((current) => ({ ...current, [draftKey]: value }));
        setDirtyKeys((current) => new Set(current).add(draftKey));
    };

    const handleSave = async () => {
        if (!data || dirtyKeys.size === 0) return;

        const fields: Record<string, string | null> = {};
        data.rows.forEach((row) => {
            row.columns.forEach((column) => {
                const draftKey = `${row.rowId}:${column.targetField}`;
                if (!dirtyKeys.has(draftKey)) return;
                const value = drafts[draftKey]?.trim() || '';
                fields[getFeedOverrideKey(row, column.targetField)] = value || null;
            });
        });

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
                                const inputClasses = `mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:bg-slate-900 dark:text-slate-100 ${column.isMissingRequired
                                    ? 'border-amber-400 dark:border-amber-600'
                                    : 'border-slate-300 dark:border-slate-600'
                                }`;

                                return (
                                    <label key={column.targetField} className="block min-w-0">
                                        <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                            {formatFeedFieldLabel(column.targetField)}
                                            {column.isMissingRequired && <span className="text-xs text-amber-600 dark:text-amber-400">Required</span>}
                                        </span>
                                        {isLongText ? (
                                            <textarea
                                                rows={4}
                                                value={value}
                                                placeholder={column.aiSuggestedValue || column.mappedValue || 'No matched value'}
                                                onChange={(event) => updateDraft(row, column.targetField, event.target.value)}
                                                className={inputClasses}
                                            />
                                        ) : (
                                            <input
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
                                    </label>
                                );
                            })}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
