import { useState } from 'react';
import { Modal } from '../ui/Modal';
import type { CannedResponse } from '../../hooks/useCannedResponses';
import { htmlToPreviewText } from '../../utils/messagePreview';

interface Props {
    responses: CannedResponse[];
    onSelect: (response: CannedResponse) => void;
    onClose: () => void;
    loading?: boolean;
    error?: boolean;
    onRetry: () => void;
}

/** Mount only while open, so each visit starts with an independent, empty search. */
export function MobileSavedRepliesSheet({ responses, onSelect, onClose, loading, error, onRetry }: Props) {
    const [query, setQuery] = useState('');
    const filter = query.trim().toLocaleLowerCase();
    const matches = responses.filter(response =>
        `${response.shortcut} ${response.label?.name || ''} ${htmlToPreviewText(response.content)}`.toLocaleLowerCase().includes(filter));

    return (
        <Modal isOpen onClose={onClose} title="Saved replies" variant="sheet">
            <label className="block text-sm font-medium text-slate-300" htmlFor="mobile-saved-reply-search">Search saved replies</label>
            <input
                id="mobile-saved-reply-search"
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search by shortcut, label or message"
                className="my-3 min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 text-base text-white focus:outline-2 focus:outline-indigo-400"
            />
            <p className="mb-3 text-xs text-slate-400">Inserts into your draft, never sends automatically</p>
            {loading ? <p role="status" className="py-6 text-slate-300">Loading saved replies…</p> : error ? <div role="alert" className="py-6 text-rose-200">
                <p>Could not load saved replies.</p>
                <button type="button" onClick={onRetry} className="mt-3 min-h-11 rounded-xl border border-white/20 px-4 text-white">Retry</button>
            </div> : matches.length ? <ul className="space-y-2">
                {matches.map(response => <li key={response.id}>
                    <button type="button" onClick={() => onSelect(response)} className="w-full rounded-xl border border-white/10 bg-slate-950/50 p-4 text-left active:bg-slate-800">
                        <span className="text-sm font-semibold text-indigo-200">/{response.shortcut}</span>
                        {response.label?.name && <span className="ml-2 text-xs text-slate-400">{response.label.name}</span>}
                        <p className="mt-2 line-clamp-4 break-words text-sm leading-relaxed text-slate-200">{htmlToPreviewText(response.content)}</p>
                    </button>
                </li>)}
            </ul> : <p className="py-8 text-center text-sm text-slate-400">{responses.length ? 'No matching saved replies. Try another search.' : 'No saved replies yet. Create them in inbox settings.'}</p>}
        </Modal>
    );
}
