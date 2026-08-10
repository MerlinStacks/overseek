import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Pencil, Play, Save, Trash2, Upload, Video } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';
import { ProductService, type ProductVideoGallery, type ProductVideoItem } from '../../services/ProductService';

const EMPTY_VIDEO: ProductVideoItem = { video_url: '', thumbnail_url: '' };

function previewSource(url: string): { kind: 'video' | 'iframe' | 'link'; src: string } {
    if (/\.(mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(url)) return { kind: 'video', src: url };
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
        // The API performs final URL validation.
    }
    return { kind: 'link', src: url };
}

function VideoPreview({ value }: { value: ProductVideoItem }) {
    const source = previewSource(value.video_url);
    if (source.kind === 'video') {
        return <video src={source.src} poster={value.thumbnail_url || undefined} controls autoPlay className="max-h-[75vh] w-full rounded-lg bg-black" />;
    }
    if (source.kind === 'iframe') {
        return <iframe src={source.src} title="Product video" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-lg bg-black" />;
    }
    return <a href={source.src} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-lg bg-slate-100 p-12 text-blue-700">Open video on provider <ExternalLink size={18} /></a>;
}

function PreviewModal({ value, onClose }: { value: ProductVideoItem; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
            <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <VideoPreview value={value} />
                <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50">Close</button>
            </div>
        </div>
    );
}

function VideoFields({ value, disabled, onChange }: { value: ProductVideoItem; disabled?: boolean; onChange: (value: ProductVideoItem) => void }) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Video URL
                <input type="url" value={value.video_url} disabled={disabled} onChange={(event) => onChange({ ...value, video_url: event.target.value })} placeholder="YouTube, Vimeo or video URL" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-100" />
            </label>
            <label className="text-xs font-medium text-slate-600">Poster image URL
                <input type="url" value={value.thumbnail_url} disabled={disabled} onChange={(event) => onChange({ ...value, thumbnail_url: event.target.value })} placeholder="Optional thumbnail URL" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal disabled:bg-slate-100" />
            </label>
        </div>
    );
}

function UploadButton({ disabled, onUpload }: { disabled?: boolean; onUpload: (file: File) => Promise<void> }) {
    const [uploading, setUploading] = useState(false);
    return (
        <label className={`inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 ${disabled || uploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}>
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload video
            <input type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.mov" disabled={disabled || uploading} className="hidden" onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setUploading(true);
                try { await onUpload(file); } finally { setUploading(false); }
            }} />
        </label>
    );
}

function VideoArtwork({ value }: { value: ProductVideoItem }) {
    return value.thumbnail_url ? (
        <img src={value.thumbnail_url} alt="Video poster" className="h-full w-full object-cover" />
    ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 text-white">
            <Video size={30} />
            <span className="mt-2 max-w-[90%] truncate text-[10px] text-slate-300">Product video</span>
        </div>
    );
}

function useVideoGallery(productId: number) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { toast } = useToast();
    const [gallery, setGallery] = useState<ProductVideoGallery | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!token || !currentAccount) return;
        setLoading(true);
        try { setGallery(await ProductService.getVideoGallery(productId, token, currentAccount.id)); }
        catch (error) { toast(error instanceof Error ? error.message : 'Could not load product video', 'error'); }
        finally { setLoading(false); }
    }, [currentAccount, productId, toast, token]);
    useEffect(() => { void load(); }, [load]);

    const upload = async (file: File): Promise<string> => {
        if (!token || !currentAccount) throw new Error('Not connected');
        if (file.size > 100 * 1024 * 1024) {
            toast('Video files must be 100 MB or smaller.', 'error');
            throw new Error('Video is too large');
        }
        try {
            const result = await ProductService.uploadVideo(productId, file, token, currentAccount.id);
            toast('Video uploaded to the WordPress Media Library.', 'success');
            return result.source_url;
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not upload video', 'error');
            throw error;
        }
    };

    return { token, currentAccount, toast, gallery, setGallery, loading, upload };
}

/** A main-product video tile rendered directly in the normal image grid. */
export function ProductVideoTile({ productId }: { productId: number }) {
    const state = useVideoGallery(productId);
    const [editing, setEditing] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState<ProductVideoItem>(EMPTY_VIDEO);
    const [policy, setPolicy] = useState<ProductVideoGallery['policy']>('per_variation');

    const openEditor = () => {
        if (!state.gallery) return;
        setDraft(state.gallery.product_video);
        setPolicy(state.gallery.policy);
        setEditing(true);
    };
    const save = async () => {
        if (!state.token || !state.currentAccount) return;
        setSaving(true);
        try {
            const updated = await ProductService.updateVideoGallery(productId, { product_video: draft, policy }, state.token, state.currentAccount.id);
            state.setGallery(updated);
            setEditing(false);
            state.toast('Product video saved', 'success');
        } catch (error) { state.toast(error instanceof Error ? error.message : 'Could not save product video', 'error'); }
        finally { setSaving(false); }
    };

    if (state.loading) return <div className="aspect-square animate-pulse rounded-lg border border-slate-200 bg-slate-100" />;
    if (!state.gallery) return null;
    const value = state.gallery.product_video;

    return (
        <>
            <div className="group relative aspect-square overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50">
                {value.video_url ? <VideoArtwork value={value} /> : <button type="button" onClick={openEditor} className="flex h-full w-full flex-col items-center justify-center text-blue-600 hover:bg-blue-50"><Video size={28} /><span className="mt-2 text-xs">Add video</span></button>}
                {value.video_url && <>
                    <button type="button" onClick={() => setPreviewing(true)} className="absolute inset-0 flex items-center justify-center bg-black/15 transition hover:bg-black/30"><span className="rounded-full bg-white/95 p-3 text-blue-700 shadow"><Play size={20} fill="currentColor" /></span></button>
                    <span className="absolute left-2 top-2 rounded-full bg-purple-600 px-2 py-1 text-[10px] font-semibold uppercase text-white">Video</span>
                    <button type="button" onClick={openEditor} className="absolute right-2 top-2 rounded-full bg-white/95 p-1.5 text-slate-700 opacity-0 shadow transition group-hover:opacity-100"><Pencil size={14} /></button>
                </>}
            </div>

            {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditing(false)}>
                <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Video size={20} /> Product video</h3>
                    <p className="mb-5 text-sm text-slate-500">This video appears with the product photos and is used by product feeds.</p>
                    <VideoFields value={draft} disabled={!state.gallery.plugin_active} onChange={setDraft} />
                    {!state.gallery.plugin_active && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">True Video Product Gallery must be active on the store.</p>}
                    {state.gallery.variations.length > 0 && <label className="mt-4 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={policy === 'inherit_main'} onChange={(event) => setPolicy(event.target.checked ? 'inherit_main' : 'per_variation')} /> Use this video for every variation</label>}
                    <div className="mt-5 flex flex-wrap justify-between gap-3">
                        <div className="flex gap-2">
                            <UploadButton disabled={!state.gallery.plugin_active} onUpload={async (file) => {
                                const video_url = await state.upload(file);
                                setDraft((current) => ({ ...current, video_url }));
                            }} />
                            {draft.video_url && <button type="button" onClick={() => setDraft(EMPTY_VIDEO)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600"><Trash2 size={16} /> Remove</button>}
                        </div>
                        <div className="flex gap-2"><button type="button" onClick={() => setEditing(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button type="button" onClick={save} disabled={saving || !state.gallery.plugin_active} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save</button></div>
                    </div>
                </div>
            </div>}
            {previewing && value.video_url && <PreviewModal value={value} onClose={() => setPreviewing(false)} />}
        </>
    );
}

/** Video controls shown inside one expanded variation row. */
export function VariantVideoEditor({ productId, variationId }: { productId: number; variationId: number }) {
    const state = useVideoGallery(productId);
    const [draft, setDraft] = useState<ProductVideoItem>(EMPTY_VIDEO);
    const [inheritMain, setInheritMain] = useState(false);
    const [saving, setSaving] = useState(false);
    const [previewing, setPreviewing] = useState(false);

    useEffect(() => {
        if (!state.gallery) return;
        const variation = state.gallery.variations.find((item) => item.variation_id === variationId);
        setDraft(variation || EMPTY_VIDEO);
        setInheritMain(state.gallery.policy === 'inherit_main');
    }, [state.gallery, variationId]);

    const save = async () => {
        if (!state.token || !state.currentAccount) return;
        setSaving(true);
        try {
            const updated = await ProductService.updateVideoGallery(productId, {
                policy: inheritMain ? 'inherit_main' : 'per_variation',
                variations: [{ variation_id: variationId, ...draft } as ProductVideoGallery['variations'][number]],
            }, state.token, state.currentAccount.id);
            state.setGallery(updated);
            state.toast('Variation video saved', 'success');
        } catch (error) { state.toast(error instanceof Error ? error.message : 'Could not save variation video', 'error'); }
        finally { setSaving(false); }
    };

    if (state.loading) return <div className="h-24 animate-pulse rounded-lg bg-slate-100" />;
    if (!state.gallery) return null;
    const effectiveValue = inheritMain ? state.gallery.product_video : draft;

    return (
        <div className="rounded-lg border border-purple-100 bg-purple-50/30 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Video size={15} className="text-purple-600" /> Variation video</h4><p className="text-[11px] text-slate-500">Shown for this variation in the WooCommerce gallery.</p></div><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={inheritMain} onChange={(event) => setInheritMain(event.target.checked)} /> Use main video for all variations</label></div>
            <VideoFields value={effectiveValue} disabled={inheritMain || !state.gallery.plugin_active} onChange={setDraft} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2"><UploadButton disabled={inheritMain || !state.gallery.plugin_active} onUpload={async (file) => {
                    const video_url = await state.upload(file);
                    setDraft((current) => ({ ...current, video_url }));
                }} />{effectiveValue.video_url && <button type="button" onClick={() => setPreviewing(true)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Play size={16} /> Preview</button>}{draft.video_url && !inheritMain && <button type="button" onClick={() => setDraft(EMPTY_VIDEO)} className="rounded-lg border border-red-200 p-2 text-red-600" title="Remove video"><Trash2 size={16} /></button>}</div>
                <button type="button" onClick={save} disabled={saving || !state.gallery.plugin_active} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save video</button>
            </div>
            {previewing && effectiveValue.video_url && <PreviewModal value={effectiveValue} onClose={() => setPreviewing(false)} />}
        </div>
    );
}
