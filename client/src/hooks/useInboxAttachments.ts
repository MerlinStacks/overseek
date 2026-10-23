import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

export function inboxAttachmentFilename(value: string): string | null {
    try {
        const url = new URL(value, window.location.origin);
        // Never send credentials to URLs supplied by an email sender.
        if (url.origin !== window.location.origin || !url.pathname.startsWith('/uploads/attachments/')) return null;
        const name = decodeURIComponent(url.pathname.slice('/uploads/attachments/'.length).replace(/%(?![\da-f]{2})/gi, '%25'));
        return name && name !== '.' && name !== '..' && !/[\\/\x00-\x1f\x7f]/.test(name) ? name : null; // eslint-disable-line no-control-regex
    } catch { return null; }
}

/** Blob URLs are inserted only AFTER sanitization; untrusted email never grants blob: access. */
export function resolveInboxAttachmentHtml(html: string, urls: Record<string, string>): string {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('img[src], a[href]').forEach(element => {
        const attribute = element.tagName === 'IMG' ? 'src' : 'href';
        const original = element.getAttribute(attribute)!;
        if (!inboxAttachmentFilename(original)) return;
        if (urls[original]) element.setAttribute(attribute, urls[original]);
        else {
            element.removeAttribute(attribute);
            if (element.tagName === 'IMG' && !element.getAttribute('alt')) element.setAttribute('alt', 'Image loading or unavailable. Use the attachment download below.');
        }
    });
    return template.innerHTML;
}

export function useInboxAttachments(messageId: string, imageUrls: string[]) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const key = JSON.stringify([messageId, accountId, token]);
    type Scope = { key: string; controller: AbortController; urls: Record<string, string>; pending: Map<string, Promise<string>> };
    const scopeRef = useRef<Scope | null>(null);
    const [snapshot, setSnapshot] = useState<{ key: string; urls: Record<string, string>; error: string | null }>({ key, urls: {}, error: null });

    useEffect(() => {
        const scope: Scope = { key, controller: new AbortController(), urls: {}, pending: new Map() };
        scopeRef.current = scope;
        return () => {
            scope.controller.abort();
            Object.values(scope.urls).forEach(url => URL.revokeObjectURL(url));
            scope.pending.clear();
        };
    }, [key]);

    const resolve = useCallback(async (url: string): Promise<string> => {
        const filename = inboxAttachmentFilename(url);
        if (!filename) return url;
        const scope = scopeRef.current;
        if (!token || !accountId || !scope || scope.key !== key || scope.controller.signal.aborted) throw new Error('Sign in and select an account to download attachments.');
        if (scope.urls[url]) return scope.urls[url];
        const existing = scope.pending.get(url);
        if (existing) return existing;
        const controller = scope.controller;
        const promise = (async () => {
            try {
                const response = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(filename)}`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId }, signal: controller.signal,
                });
                if (!response.ok) throw new Error('Attachment unavailable. Please try downloading again.');
                const blob = await response.blob();
                if (controller.signal.aborted || scopeRef.current !== scope) throw new DOMException('Aborted', 'AbortError');
                const objectUrl = URL.createObjectURL(blob);
                scope.urls[url] = objectUrl;
                setSnapshot({ key, urls: { ...scope.urls }, error: null });
                return objectUrl;
            } catch (error) {
                if (!controller.signal.aborted && scopeRef.current === scope) setSnapshot({ key, urls: { ...scope.urls }, error: 'Attachment unavailable. Please try downloading again.' });
                throw error;
            } finally {
                if (scope.controller === controller) scope.pending.delete(url);
            }
        })();
        scope.pending.set(url, promise);
        return promise;
    }, [key, messageId, accountId, token]);

    const imageKey = JSON.stringify(imageUrls);
    useEffect(() => {
        if (!token || !accountId || !scopeRef.current) return;
        const urls: string[] = JSON.parse(imageKey);
        // Avoid starting an unbounded number of image downloads for a long email thread.
        let next = 0;
        const controller = scopeRef.current.controller;
        const worker = async () => {
            while (!controller.signal.aborted && next < urls.length) {
                const url = urls[next++];
                try { await resolve(url); } catch { /* An explicit download can retry failed reads. */ }
            }
        };
        void Promise.all([worker(), worker(), worker()]);
    }, [imageKey, resolve, token, accountId]);

    // Never display an old account/session's bytes, even before effect cleanup has run.
    return { urls: snapshot.key === key ? snapshot.urls : {}, resolve, error: snapshot.key === key ? snapshot.error : null };
}
