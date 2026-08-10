import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Play, Save, Trash2, Upload, Video } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';
import { ProductService, type ProductVideoGallery as Gallery, type ProductVideoItem } from '../../services/ProductService';

function previewSource(url: string): { kind: 'video' | 'iframe' | 'link'; src: string } {
    if (/\.(mp4|webm|ogg)(?:[?#].*)?$/i.test(url)) return { kind: 'video', src: url };
    try {
        const parsed = new URL(url);
        if (/(^|\.)youtu\.be$/i.test(parsed.hostname)) {
            return { kind: 'iframe', src: `https://www.youtube.com/embed/${parsed.pathname.split('/').filter(Boolean)[0] || ''}` };
        }
        if (/(^|\.)youtube\.com$/i.test(parsed.hostname)) {
            const id = parsed.searchParams.get('v') || parsed.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1];
            if (id) return { kind: 'iframe', src: `https://www.youtube.com/embed/${id}` };
        }
        if (/(^|\.)vimeo\.com$/i.test(parsed.hostname)) {
            const id = parsed.pathname.match(/\/(\d+)/)?.[1];
            if (id) return { kind: 'iframe', src: `https://player.vimeo.com/video/${id}` };
        }
    } catch {
        // URL validation is also performed by the API.
    }
    return { kind: 'link', src: url };
}

function VideoPreview({ url, thumbnail }: { url: string; thumbnail?: string }) {
    const source = previewSource(url);
    if (source.kind === 'video') {
        return <video src={source.src} poster={thumbnail || undefined} controls autoPlay className="max-h-[75vh] w-full rounded-lg bg-black" />;
    }
    if (source.kind === 'iframe') {
        return <iframe src={source.src} title="Product video" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-lg bg-black" />;
    }
    return (
        <a href={source.src} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-lg bg-slate-100 p-12 text-blue-700 hover:bg-slate-200">
            Open video on provider <ExternalLink size={18} />
        </a>
    );
}

function VideoFields({ value, disabled, onChange, onPreview, onUpload }: {
    value: ProductVideoItem;
    disabled?: boolean;
    onChange: (next: ProductVideoItem) => void;
    onPreview: () => void;
    onUpload?: (file: File) => Promise<void>;
}) {
    const [uploading, setUploading] = useState(false);
    return (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-sm font-medium text-slate-700">
                Video URL
                <input type="url" value={value.video_url} disabled={disabled} placeholder="YouTube, Vimeo, TikTok, Instagram or .mp4 URL" onChange={(event) => onChange({ ...value, video_url: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100" />
            </label>
            <label className="text-sm font-medium text-slate-700">
                Thumbnail URL
                <input type="url" value={value.thumbnail_url} disabled={disabled} placeholder="Optional poster image URL" onChange={(event) => onChange({ ...value, thumbnail_url: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100" />
            </label>
            <div className="flex gap-2">
                <label className={`rounded-lg border border-blue-200 p-2 text-blue-700 hover:bg-blue-50 ${disabled || uploading ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`} title="Upload video to WordPress">
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                    <input
                        type="file"
                        accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.mov"
                        disabled={disabled || uploading}
                        className="hidden"
                        onChange={async (event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (!file || !onUpload) return;
                            setUploading(true);
                            try { await onUpload(file); } finally { setUploading(false); }
                        }}
                    />
                </label>
                <button type="button" disabled={!value.video_url} onClick={onPreview} className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-40" title="Watch video"><Play size={18} /></button>
                <button type="button" disabled={disabled || (!value.video_url && !value.thumbnail_url)} onClick={() => onChange({ video_url: '', thumbnail_url: '' })} className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-40" title="Clear video"><Trash2 size={18} /></button>
            </div>
        </div>
    );
}

export function ProductVideoGallery({ productId, embedded = false }: { productId: number; embedded?: boolean }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { toast } = useToast();
    const [gallery, setGallery] = useState<Gallery | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [preview, setPreview] = useState<ProductVideoItem | null>(null);

    const load = useCallback(async () => {
        if (!token || !currentAccount) return;
        setLoading(true);
        try {
            setGallery(await ProductService.getVideoGallery(productId, token, currentAccount.id));
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not load product videos', 'error');
        } finally {
            setLoading(false);
        }
    }, [currentAccount, productId, toast, token]);

    useEffect(() => { void load(); }, [load]);

    const change = (updater: (current: Gallery) => Gallery) => {
        setGallery((current) => current ? updater(current) : current);
        setDirty(true);
    };

    const save = async () => {
        if (!gallery || !token || !currentAccount) return;
        setSaving(true);
        try {
            const updated = await ProductService.updateVideoGallery(productId, {
                policy: gallery.policy,
                product_video: gallery.product_video,
                variations: gallery.variations,
            }, token, currentAccount.id);
            setGallery(updated);
            setDirty(false);
            toast('Product videos saved. Feed video links now use these values.', 'success');
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not save product videos', 'error');
        } finally {
            setSaving(false);
        }
    };

    const uploadVideo = async (file: File, onUploaded: (url: string) => void) => {
        if (!token || !currentAccount) return;
        if (file.size > 100 * 1024 * 1024) {
            toast('Video files must be 100 MB or smaller.', 'error');
            return;
        }
        try {
            const uploaded = await ProductService.uploadVideo(productId, file, token, currentAccount.id);
            onUploaded(uploaded.source_url);
            toast('Video uploaded to the WordPress Media Library. Save videos to publish it.', 'success');
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not upload video', 'error');
            throw error;
        }
    };

    if (loading) return <div className="flex items-center gap-2 p-8 text-slate-500"><Loader2 className="animate-spin" size={18} /> Loading product videos…</div>;
    if (!gallery) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">Product videos could not be loaded. Ensure the latest Overseek store plugin is installed.</div>;

    return (
        <div className="space-y-6">
            <div className={`flex flex-wrap items-center justify-between gap-3 ${embedded ? '' : 'rounded-xl border border-slate-200 bg-white p-5 shadow-xs'}`}>
                <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Video size={20} /> Product videos</h2>
                    <p className="mt-1 text-sm text-slate-500">Stored in True Video Product Gallery and used as the default Video Link in product feeds.</p>
                </div>
                <button type="button" onClick={save} disabled={!dirty || saving || !gallery.plugin_active} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Save videos
                </button>
            </div>

            {!gallery.plugin_active && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">True Video Product Gallery is not active on this store. Activate it before editing videos.</div>}

            <section className={`rounded-xl border border-slate-200 p-5 ${embedded ? 'bg-slate-50/70' : 'bg-white shadow-xs'}`}>
                <h3 className="mb-4 font-semibold text-slate-900">Main product video</h3>
                <VideoFields
                    value={gallery.product_video}
                    disabled={!gallery.plugin_active}
                    onPreview={() => setPreview(gallery.product_video)}
                    onChange={(product_video) => change((current) => ({ ...current, product_video }))}
                    onUpload={(file) => uploadVideo(file, (video_url) => change((current) => ({ ...current, product_video: { ...current.product_video, video_url } })))}
                />
            </section>

            {gallery.variations.length > 0 && (
                <section className={`rounded-xl border border-slate-200 p-5 ${embedded ? 'bg-slate-50/70' : 'bg-white shadow-xs'}`}>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="font-semibold text-slate-900">Variation videos</h3>
                            <p className="text-sm text-slate-500">A variation video overrides the main video in feeds; empty variations fall back to the main video.</p>
                        </div>
                        <select value={gallery.policy} disabled={!gallery.plugin_active} onChange={(event) => change((current) => ({ ...current, policy: event.target.value as Gallery['policy'] }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                            <option value="per_variation">Use per-variation videos</option>
                            <option value="inherit_main">Use main video for all variations</option>
                        </select>
                    </div>
                    <div className="divide-y divide-slate-200">
                        {gallery.variations.map((variation, index) => {
                            const label = Object.values(variation.attributes || {}).filter(Boolean).join(' / ') || variation.sku || `Variation ${variation.variation_id}`;
                            return (
                                <div key={variation.variation_id} className="py-5 first:pt-0 last:pb-0">
                                    <div className="mb-3 text-sm font-semibold text-slate-800">{label} <span className="font-normal text-slate-400">#{variation.variation_id}</span></div>
                                    <VideoFields
                                        value={variation}
                                        disabled={!gallery.plugin_active || gallery.policy === 'inherit_main'}
                                        onPreview={() => setPreview(variation)}
                                        onChange={(next) => change((current) => ({ ...current, variations: current.variations.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item) }))}
                                        onUpload={(file) => uploadVideo(file, (video_url) => change((current) => ({ ...current, variations: current.variations.map((item, itemIndex) => itemIndex === index ? { ...item, video_url } : item) })))}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {preview?.video_url && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setPreview(null)}>
                    <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <VideoPreview url={preview.video_url} thumbnail={preview.thumbnail_url} />
                        <button type="button" onClick={() => setPreview(null)} className="mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50">Close</button>
                    </div>
                </div>
            )}
        </div>
    );
}
