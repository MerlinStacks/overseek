import { useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createParagraphNode, $getRoot, $getSelection, $insertNodes, $isRangeSelection, $setSelection, type RangeSelection } from 'lexical';
import { $generateNodesFromDOM } from '@lexical/html';
import { renderSocialIconLink } from '@overseek/core';
import { useAuth } from '../../../../context/AuthContext';
import { useAccount } from '../../../../context/AccountContext';
import { EmailImageNode, validEmailImageUrl } from '../EmailImageNode';

export function EmailMediaPlugin({ images, social }: { images: boolean; social: boolean }) {
    const [editor] = useLexicalComposerContext();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [mode, setMode] = useState<'image' | 'social' | null>(null);
    const [src, setSrc] = useState('');
    const [alt, setAlt] = useState('');
    const [width, setWidth] = useState(200);
    const [links, setLinks] = useState<Array<{ label: string; href: string }>>([]);
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const selection = useRef<RangeSelection | null>(null);
    const request = useRef<AbortController | null>(null);
    const dialog = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);
    const close = () => { request.current?.abort(); setUploading(false); setMode(null); trigger.current?.focus(); };
    useEffect(() => () => request.current?.abort(), []);
    useEffect(() => { request.current?.abort(); setMode(null); setUploading(false); setSrc(''); }, [currentAccount?.id]);
    useEffect(() => { if (mode) dialog.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [mode]);
    const open = (next: 'image' | 'social', button: HTMLButtonElement) => {
        trigger.current = button;
        editor.getEditorState().read(() => { const current = $getSelection(); selection.current = $isRangeSelection(current) ? current.clone() : null; });
        setError(''); setSrc(''); setAlt(''); setWidth(200);
        setLinks(currentAccount?.appearance?.socialLinks?.length ? currentAccount.appearance.socialLinks.map(link => ({ ...link })) : [{ label: 'Facebook', href: '' }, { label: 'Instagram', href: '' }]);
        setMode(next);
    };
    const upload = async (file: File) => {
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Use PNG, JPG, GIF or WebP, up to 5MB.'); return; }
        if (!token || !currentAccount?.id) { setError('Select an account and sign in to upload.'); return; }
        request.current?.abort();
        const controller = new AbortController(); request.current = controller;
        setUploading(true); setError('');
        try {
            const body = new FormData(); body.append('file', file);
            const response = await fetch('/api/marketing/designer/assets', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id }, body, signal: controller.signal });
            const result = await response.json();
            if (!response.ok || !validEmailImageUrl(result.url || '')) throw new Error(result.error || 'Image upload failed.');
            if (!controller.signal.aborted) setSrc(result.url);
        } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Upload failed.'); }
        finally { if (!controller.signal.aborted) setUploading(false); }
    };
    const insert = () => {
        const usableLinks = links.filter(link => link.href.trim());
        if (mode === 'image' && (!validEmailImageUrl(src.trim()) || !alt.trim())) { setError('Enter a public HTTPS image URL and alternative text.'); return; }
        if (mode === 'social' && (!usableLinks.length || usableLinks.some(link => !link.label.trim() || !validEmailImageUrl(link.href.trim())))) { setError('Add a label and valid HTTPS URL for each social link.'); return; }
        editor.update(() => {
            const saved = selection.current;
            if (saved?.anchor.getNode().isAttached() && saved.focus.getNode().isAttached()) $setSelection(saved.clone());
            else { const paragraph = $createParagraphNode(); $getRoot().append(paragraph); paragraph.selectEnd(); }
            if (mode === 'image') $insertNodes([new EmailImageNode(src.trim(), alt.trim(), Math.min(600, Math.max(16, width || 200)))]);
            else {
                const html = usableLinks.map(link => renderSocialIconLink(link.label.trim(), link.href.trim(), 'glyph', '#4f46e5', 'native')).join(' ');
                $insertNodes($generateNodesFromDOM(editor, new DOMParser().parseFromString(html, 'text/html')));
            }
        });
        close();
    };
    const inputClass = 'w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';
    return <>
        <div className="flex flex-wrap gap-2 border-b border-gray-200 p-2 dark:border-slate-700" onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}>
            {images && <button type="button" className="rounded border px-3 py-1 text-sm" onClick={event => open('image', event.currentTarget)}>Add image</button>}
            {social && <button type="button" className="rounded border px-3 py-1 text-sm" onClick={event => open('social', event.currentTarget)}>Add social links</button>}
        </div>
        {mode && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
            <div ref={dialog} role="dialog" aria-modal="true" aria-label={mode === 'image' ? 'Add footer image' : 'Add social links'} className="max-h-[85dvh] w-full max-w-lg space-y-3 overflow-auto rounded-xl bg-white p-5 text-gray-900 shadow-xl dark:bg-slate-900 dark:text-white" onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); close(); }
                if (event.key === 'Tab') {
                    const controls = dialog.current?.querySelectorAll<HTMLElement>('input, select, button:not(:disabled)');
                    if (!controls?.length) return;
                    const first = controls[0], last = controls[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
            }}>
                <h3 className="font-semibold">{mode === 'image' ? 'Add image' : 'Social links'}</h3>
                {mode === 'image' ? <>
                    <label className="block text-sm">Image URL<input className={inputClass} value={src} onChange={event => setSrc(event.target.value)} placeholder="https://…" /></label>
                    <label className="block text-sm">Upload image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
                    {uploading && <p role="status">Uploading…</p>}
                    <label className="block text-sm">Alternative text<input className={inputClass} value={alt} onChange={event => setAlt(event.target.value)} /></label>
                    <label className="block text-sm">Width (px)<input type="number" min={16} max={600} className={inputClass} value={width} onChange={event => setWidth(Number(event.target.value))} /></label>
                </> : <>
                    <p className="text-sm text-gray-500">Uses the same platform icons as the email designer. Leave unused URLs blank.</p>
                    {links.map((link, index) => <div key={index} className="flex gap-2">
                        <input aria-label={`Social platform ${index + 1}`} className={inputClass} value={link.label} onChange={event => setLinks(links.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
                        <input aria-label={`Social URL ${index + 1}`} className={inputClass} value={link.href} placeholder="https://…" onChange={event => setLinks(links.map((item, i) => i === index ? { ...item, href: event.target.value } : item))} />
                        <button type="button" aria-label={`Remove social link ${index + 1}`} onClick={() => setLinks(links.filter((_, i) => i !== index))}>×</button>
                    </div>)}
                    <button type="button" onClick={() => setLinks([...links, { label: '', href: '' }])}>+ Add link</button>
                </>}
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-3"><button type="button" onClick={close}>Cancel</button><button type="button" disabled={uploading} onClick={insert} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">Insert</button></div>
            </div>
        </div>}
    </>;
}
