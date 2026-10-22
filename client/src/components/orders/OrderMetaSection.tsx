/* eslint-disable react-refresh/only-export-components */
import { useId, useState } from 'react';
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
    if (!loaded) return <button type="button" className="rounded border p-2" onClick={() => setLoaded(true)}>Load external image: {label} ({new URL(url).hostname})</button>;
    if (failed) return <span>{label}: image unavailable</span>;
    return <button type="button" aria-label={`Open image ${label}`} onClick={() => onImageClick(url)} className="rounded border p-1"><img src={url} alt={label} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} className="size-16 object-cover" /></button>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function OrderMetaSection({ metaData, onImageClick }: { metaData: Meta[]; onImageClick: (url: string) => void }) {
    const id = useId(), [expanded, setExpanded] = useState(true);
    if (!Array.isArray(metaData) || metaData.length > 200 || metaData.some(value => !record(value) || typeof value.key !== 'string' || value.key.length > 200 || typeof value.value !== 'string' || value.value.length > 20000 || ['display_key', 'display_value'].some(key => value[key] !== undefined && (typeof value[key] !== 'string' || String(value[key]).length > 20000)))) return <p role="status">Order metadata unavailable: unsupported or oversized data.</p>;
    const rows = metaData.filter(row => !row.key.startsWith('_'));
    if (!rows.length) return null;
    const category = (row: Meta) => extractImageUrl(row.value) ? 'Uploaded Files' : row.key.startsWith('pa_') || ['size', 'color', 'colour', 'variant', 'style', 'material', 'weight'].includes(row.key.toLowerCase()) ? 'Product Options' : 'Custom Fields';
    return <section className="mt-3 rounded border border-slate-200 dark:border-slate-700 p-3 text-slate-900 dark:text-slate-100"><button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>Order item details ({rows.length})</button><div id={id} hidden={!expanded} className="space-y-3 pt-2">{['Product Options', 'Custom Fields', 'Uploaded Files'].map(group => {
        const items = rows.filter(row => category(row) === group); if (!items.length) return null;
        return <section key={group} className="space-y-2"><h4 className="font-semibold">{group}</h4>{items.map((row, index) => {
            const images = extractAllImageUrls(row.value), label = fixMojibake(row.display_key || row.key.replace(/^pa_/, '').replace(/_/g, ' '));
            return <div key={`${row.key}:${index}`} className="break-words"><strong>{label}</strong><p className="whitespace-pre-line">{fixMojibake(row.display_value || row.value).replace(/<br\s*\/?>/gi, '\n').replace(/\\n/g, '\n')}</p>{images.length > 0 && <div className="flex flex-wrap gap-2">{images.map(url => <ImageThumbnail key={url} item={{ key: label, value: row.value, imageUrl: url }} onImageClick={onImageClick} />)}</div>}</div>;
        })}</section>;
    })}<p className="text-xs text-slate-500 dark:text-slate-400">External images load only when requested. Their host will receive your network request; no referrer is sent. Only the first 12 detected images per field are offered.</p></div></section>;
}
