import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

export const MOBILE_DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
export function mobileDraftKey(userId?: string, accountId?: string, conversationId?: string) {
    return userId && accountId && conversationId
        ? `mobile-chat-draft:v1:${JSON.stringify([userId, accountId, conversationId])}` : null;
}

interface PendingTextSend {
    content: string;
    clientRequestId: string;
    revision: number;
    createdAt: number;
}

interface DraftState {
    key: string | null;
    content: string;
    revision: number;
    pending?: PendingTextSend;
}

function isFresh(timestamp: number) {
    return Number.isFinite(timestamp) && timestamp <= Date.now() && Date.now() - timestamp < MOBILE_DRAFT_TTL;
}

function readDraft(key: string | null): DraftState {
    const empty = { key, content: '', revision: 0 };
    if (!key) return empty;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return empty;
        const draft = JSON.parse(raw);
        if (typeof draft.content === 'string' && isFresh(draft.updatedAt)) {
            const revision = Number.isSafeInteger(draft.revision) && draft.revision >= 0 ? draft.revision : 0;
            const pending = draft.pending;
            return { key, content: draft.content, revision,
                pending: pending && typeof pending.content === 'string' && typeof pending.clientRequestId === 'string'
                    && pending.clientRequestId && pending.revision === revision && isFresh(pending.createdAt)
                    ? pending : undefined };
        }
        localStorage.removeItem(key);
    } catch { /* Storage may be disabled or corrupt; composing must still work. */ }
    return empty;
}

function writeDraft(draft: DraftState) {
    if (!draft.key) return;
    try {
        if (draft.content) localStorage.setItem(draft.key, JSON.stringify({
            content: draft.content, revision: draft.revision, pending: draft.pending, updatedAt: Date.now(),
        }));
        else localStorage.removeItem(draft.key);
    } catch { /* Quota/security failures must not interrupt editing or sending. */ }
}

/** Write through edits and send identity together before starting the request. */
export function useMobileChatDraft(key: string | null) {
    const restored = useMemo(() => readDraft(key), [key]);
    const [state, setState] = useState(restored);
    const current = state.key === key ? state : restored;
    const draftRef = useRef(current);
    useLayoutEffect(() => { draftRef.current = current; }, [current]);
    const setDraft = useCallback((value: string | ((previous: string) => string)) => {
        if (draftRef.current.key !== key) return;
        const content = typeof value === 'function' ? value(draftRef.current.content) : value;
        if (content === draftRef.current.content) return;
        const next = { key, content, revision: draftRef.current.revision + 1 };
        draftRef.current = next;
        setState(next);
        writeDraft(next);
    }, [key]);
    const prepareSend = useCallback((content: string, createId: () => string) => {
        const draft = draftRef.current;
        const retry = draft.pending;
        const pending = retry && retry.content === content && retry.revision === draft.revision && isFresh(retry.createdAt)
            ? retry : { content, clientRequestId: createId(), revision: draft.revision, createdAt: Date.now() };
        const next = { ...draft, pending };
        draftRef.current = next;
        setState(next);
        writeDraft(next);
        return pending;
    }, []);
    const completeSend = useCallback((sentKey: string | null, sent: PendingTextSend) => {
        const draft = draftRef.current;
        if (draft.key !== sentKey || draft.revision !== sent.revision
            || draft.pending?.clientRequestId !== sent.clientRequestId || draft.pending.content !== sent.content) return;
        const next = { key: sentKey, content: '', revision: draft.revision + 1 };
        draftRef.current = next;
        setState(next);
        // A different tab may have saved newer content under the same key.
        if (!sentKey) return;
        try {
            const saved = JSON.parse(localStorage.getItem(sentKey) || 'null');
            if (saved?.revision === sent.revision && saved.content === draft.content
                && saved.pending?.clientRequestId === sent.clientRequestId && saved.pending.content === sent.content) {
                localStorage.removeItem(sentKey);
            }
        } catch { /* In-memory completion still works when storage is unavailable. */ }
    }, []);
    return { newMessage: current.content, setNewMessage: setDraft, draftRef, prepareSend, completeSend };
}

/** Rich editor accepts HTML or plain text; escape plain text when joining HTML blocks. */
export function emailDraftHtml(value: string): string {
    if (/<\/?[a-z][^>]*>/i.test(value)) return DOMPurify.sanitize(value);
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    return escaped.split(/\n\s*\n/).map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`).join('');
}
