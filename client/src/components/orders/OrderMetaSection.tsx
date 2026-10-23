/* eslint-disable react-refresh/only-export-components */
import { useId, useState } from 'react';
import { ChevronDown, Image as ImageIcon, Settings } from 'lucide-react';
import { fixMojibake } from '../../utils/format';
interface Meta { key: string; value: string; display_key?: string; display_value?: string }
interface Item { key: string; value: string; imageUrl?: string | null }
function safeImage(value: string): string | null {
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || value.length > 2048 || !/\.(jpe?g|png|gif|webp|bmp)$/i.test(url.pathname)) return null; return url.href; } catch { return null; }
}
export function extractAllImageUrls(value: string): string[] {
    if (typeof value !== 'string' || value.length > 20000) return [];
    return [...new Set((value.match(/https:\/\/[^\s|,<>"']+/g) || []).flatMap(candidate => { const url = safeImage(candidate); return url ? [url] : []; }))].slice(0, 12);
}
export function extractImageUrl(value: string) { return extractAllImageUrls(value)[0] || null; }
export function ImageThumbnail({ item, onImageClick }: { item: Item; onImageClick: (url: string) => void }) {
    const url = item.imageUrl ? safeImage(item.imageUrl) : null;
    return url ? <ConsentThumbnail key={url} label={item.key} url={url} onImageClick={onImageClick} /> : <span>{item.key}: image unavailable</span>;
}
function ConsentThumbnail({ label, url, onImageClick }: { label: string; url: string; onImageClick: (url: string) => void }) {
    const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
    if (!loaded) return <button type="button" className="flex max-w-full items-center gap-2 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-left text-xs text-amber-800 transition-colors hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-amber-800 dark:bg-slate-800 dark:text-amber-200 dark:hover:bg-slate-700" onClick={() => setLoaded(true)}><ImageIcon size={16} className="shrink-0" /><span className="min-w-0 break-all">Load external image: {label}<span className="block text-[10px] opacity-75">{new URL(url).hostname}</span></span></button>;
    if (failed) return <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{label}: image unavailable</span>;
    return <button type="button" aria-label={`Open image ${label}`} onClick={() => onImageClick(url)} className="cursor-zoom-in overflow-hidden rounded-lg border-2 border-transparent shadow-sm transition-colors hover:border-purple-400 focus-visible:outline-2 focus-visible:outline-indigo-500"><img src={url} alt={label} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} className="size-16 object-cover" /></button>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function OrderMetaSection({ metaData, onImageClick }: { metaData: Meta[]; onImageClick: (url: string) => void }) {
    const id = useId();
    const [collapsed, setCollapsed] = useState<string[]>([]);
    if (!Array.isArray(metaData) || metaData.length > 200 || metaData.some(value => !record(value) || typeof value.key !== 'string' || value.key.length > 200 || typeof value.value !== 'string' || value.value.length > 20000 || ['display_key', 'display_value'].some(key => value[key] !== undefined && (typeof value[key] !== 'string' || String(value[key]).length > 20000)))) return <p role="status">Order metadata unavailable: unsupported or oversized data.</p>;
    const rows = metaData.filter(row => !row.key.startsWith('_'));
    if (!rows.length) return null;
    const category = (row: Meta) => extractImageUrl(row.value) ? 'Uploaded Files' : row.key.startsWith('pa_') || ['size', 'color', 'colour', 'variant', 'style', 'material', 'weight'].includes(row.key.toLowerCase()) ? 'Product Options' : 'Custom Fields';
    const renderRow = (row: Meta, index: number) => {
        const label = fixMojibake(row.display_key || row.key.replace(/^pa_/, '').replace(/_/g, ' '));
        const value = fixMojibake(row.display_value || row.value).replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
        let href: string | undefined;
        try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !/\s/.test(value)) href = url.href; } catch { /* Render non-URLs as plain text. */ }
        return <div key={`${row.key}:${index}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="min-w-20 font-medium capitalize text-slate-600 dark:text-slate-400">{label}:</span>
            <span className={`min-w-0 flex-1 break-all whitespace-pre-line ${category(row) === 'Product Options' ? 'font-medium text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'}`}>
                {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400" title={value}>{value.length > 60 ? `${value.slice(0, 60)}…` : value}</a> : value}
            </span>
        </div>;
    };
    return <section aria-label="Order item details" className="mt-3 min-w-0 space-y-2">
        {rows.some(row => category(row) === 'Product Options') && <div aria-label="Product Options" className="grid gap-1.5">{rows.filter(row => category(row) === 'Product Options').map(renderRow)}</div>}
        {['Custom Fields', 'Uploaded Files'].map((group, groupIndex) => {
            const items = rows.filter(row => category(row) === group);
            if (!items.length) return null;
            const uploads = group === 'Uploaded Files', expanded = !collapsed.includes(group), contentId = `${id}-${groupIndex}`;
            const Icon = uploads ? ImageIcon : Settings;
            return <section key={group} className={`min-w-0 overflow-hidden rounded-lg border ${uploads ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30' : 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30'}`}>
                <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setCollapsed(previous => expanded ? [...previous, group] : previous.filter(value => value !== group))} className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-white/30 dark:hover:bg-white/5 ${uploads ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'}`}>
                    <span className="flex items-center gap-2"><Icon size={12} />{group}<span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[10px] dark:bg-white/10">{items.length}</span></span><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
                </button>
                <div id={contentId} hidden={!expanded} className="space-y-2 bg-white/40 px-3 pb-3 pt-1 dark:bg-slate-900/20">
                    {uploads ? <><div className="flex flex-wrap gap-2">{items.flatMap((row, index) => extractAllImageUrls(row.value).map(url => <ImageThumbnail key={`${index}:${url}`} item={{ key: fixMojibake(row.display_key || row.key.replace(/_/g, ' ')), value: row.value, imageUrl: url }} onImageClick={onImageClick} />))}</div><p className="text-[10px] text-slate-500 dark:text-slate-400">External images load only when requested. Their host receives your network request; no referrer is sent. Up to 12 images per field.</p></> : items.map(renderRow)}
                </div>
            </section>;
        })}
    </section>;
}
