import { useEffect, useState } from 'react';
import { File, Loader2, X } from 'lucide-react';

interface Props {
    file: File;
    uploading: boolean;
    progress: number | null;
    onRemove: () => void;
    onSend: () => void;
    sendingMessage: boolean;
}

export function MobileAttachmentPreview({ file, uploading, progress, onRemove, onSend, sendingMessage }: Props) {
    const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
    useEffect(() => {
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return;
        const url = URL.createObjectURL(file);
        setPreview({ file, url });
        return () => URL.revokeObjectURL(url);
    }, [file]);

    return (
        <section aria-label="Attachment review" className="m-3 shrink-0 rounded-2xl border border-indigo-300/20 bg-slate-900 p-3">
            <div className="flex items-center gap-3">
                {preview?.file === file ? <img src={preview.url} alt="Selected attachment preview" className="h-12 w-12 rounded-lg object-cover" /> : <File aria-hidden size={32} className="shrink-0 text-slate-400" />}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{file.name}</p>
                    <p className="text-xs text-slate-400">{file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</p>
                </div>
                <button type="button" aria-label="Remove attachment" onClick={onRemove} disabled={uploading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-300 disabled:opacity-40"><X size={20} /></button>
            </div>
            <div className="mt-2 flex items-center gap-3">
                <p className="flex-1 text-xs text-slate-400">Sent separately from your reply. Files are not saved when you leave.</p>
                <button type="button" onClick={onSend} disabled={uploading || sendingMessage} className="min-h-11 shrink-0 rounded-xl bg-indigo-500 px-3 text-sm font-semibold text-white disabled:opacity-50">
                    {uploading ? <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Sending…</span> : 'Send attachment'}
                </button>
            </div>
            {uploading && <div role="status" className="mt-2 text-xs text-indigo-200">
                {progress == null ? 'Uploading and delivering attachment…' : `Uploading attachment: ${Math.round(progress)}%`}
                <progress aria-label="Attachment upload" max={100} value={progress ?? undefined} className="mt-1 block h-1 w-full" />
            </div>}
        </section>
    );
}
