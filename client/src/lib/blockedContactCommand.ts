import { z } from 'zod';
import { readBoundedBytes } from '../utils/boundedResponse';
const uncertain = new Map<string, string>();
const snapshot = z.object({ accountId: z.string(), email: z.string().email(), version: z.string().datetime().nullable(), conversationVersion: z.string().datetime().optional() });
/** Preflight is an observation, not permission to replay an uncertain command. */
export async function changeBlockedContact(token: string, accountId: string, target: { conversationId: string } | { email: string }, blocked: boolean, signal?: AbortSignal) {
    const key = JSON.stringify([accountId, target, blocked]);
    const pending = uncertain.get(key);
    if (pending) throw new Error(`Block command pending/unconfirmed. Reconcile operation ${pending}.`);
    const operationId = crypto.randomUUID();
    uncertain.set(key, operationId);
    let submitted = false;
    const headers = { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' };
    // Older browsers support AbortController but not AbortSignal.any/timeout.
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 15000);
    const requestSignal = controller.signal;
    try {
        const readUrl = 'conversationId' in target ? `/api/chat/${encodeURIComponent(target.conversationId)}/block-state` : `/api/chat/block/check/${encodeURIComponent(target.email)}`;
        const read = await fetch(readUrl, { headers, signal: requestSignal });
        if (!read.ok) throw new Error('Block state unavailable; no command submitted');
        const observed = snapshot.parse(JSON.parse(new TextDecoder().decode(await readBoundedBytes(read, 64000))));
        if (observed.accountId !== accountId) throw new Error('Block scope mismatch');
        if (requestSignal.aborted) throw new Error('Block request cancelled');
        const path = 'conversationId' in target ? `/api/chat/${encodeURIComponent(target.conversationId)}/block` : blocked ? '/api/chat/block' : `/api/chat/block/${encodeURIComponent(observed.email)}`;
        const body = { operationId, version: observed.version, ...(observed.conversationVersion ? { conversationVersion: observed.conversationVersion } : {}), ...(blocked ? { email: observed.email, reason: 'Blocked from inbox' } : {}) };
        submitted = true;
        const response = await fetch(path, { method: blocked ? 'POST' : 'DELETE', headers, signal: requestSignal, body: JSON.stringify(body) });
        if (!response.ok) throw new Error('Block command not acknowledged');
        const ack = z.object({ success: z.literal(true), accountId: z.string(), email: z.string(), operationId: z.string(), blocked: z.boolean() }).parse(JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 64000))));
        if (ack.accountId !== accountId || ack.email !== observed.email || ack.operationId !== operationId || ack.blocked !== blocked) throw new Error('Block acknowledgement mismatch');
        uncertain.delete(key);
    } catch (error) {
        if (!submitted) { uncertain.delete(key); throw error; }
        throw Object.assign(new Error(`Block command unconfirmed. Reconcile operation ${operationId}; do not repeat with a new identity.`), { cause: error });
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}
