import { useEffect, useState } from 'react';

const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 5000;
interface Message { type: 'claim' | 'heartbeat' | 'resign'; tabId: string; timestamp: number }
function validMessage(value: unknown): value is Message {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return Object.keys(row).length === 3 && ['claim', 'heartbeat', 'resign'].includes(String(row.type)) && typeof row.tabId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(row.tabId) && typeof row.timestamp === 'number' && Number.isFinite(row.timestamp) && Math.abs(Date.now() - row.timestamp) <= TIMEOUT_MS;
}

/** Advisory polling load reduction only. Suspension, message loss or hostile same-origin
 * peers can produce multiple/no leaders. NEVER use this as mutation authority. Each hook
 * owns its candidacy so disposing a sibling cannot resign a still-live instance. */
export function useTabLeader(channelName: string): { isLeader: boolean; tabId: string } {
    const [tabId] = useState(() => `tab-${crypto.randomUUID()}`);
    const [observation, setObservation] = useState({ channel: '', leader: false });
    useEffect(() => {
        let active = true;
        let channel: BroadcastChannel | undefined;
        const peers = new Map<string, number>();
        const update = (leader: boolean) => { if (active) setObservation({ channel: channelName, leader }); };
        const send = (type: Message['type']) => {
            try { channel?.postMessage({ type, tabId, timestamp: Date.now() }); } catch { /* advisory transport failure is not authority */ }
        };
        const elect = () => {
            const now = performance.now();
            for (const [id, received] of peers) if (now - received >= TIMEOUT_MS) peers.delete(id);
            update(![...peers.keys()].some(id => id < tabId));
        };
        try {
            if (!channelName || channelName.length > 200) throw new Error('Invalid channel');
            channel = new BroadcastChannel(channelName);
            channel.onmessage = event => {
                if (!active || !validMessage(event.data) || event.data.tabId === tabId) return;
                const message = event.data;
                if (message.type === 'resign') peers.delete(message.tabId);
                else if (peers.has(message.tabId) || peers.size < 100) peers.set(message.tabId, performance.now());
                if (message.type === 'claim') send('heartbeat');
                elect();
            };
            send('claim');
        } catch { channel = undefined; }
        const timer = setInterval(() => { if (active) { send('heartbeat'); elect(); } }, HEARTBEAT_MS);
        const resume = () => { peers.clear(); send('claim'); elect(); };
        document.addEventListener('visibilitychange', resume);
        queueMicrotask(() => { if (active) elect(); });
        return () => {
            active = false;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', resume);
            send('resign');
            if (channel) { channel.onmessage = null; try { channel.close(); } catch { /* best effort */ } }
            peers.clear();
        };
    }, [channelName, tabId]);
    return { isLeader: observation.channel === channelName && observation.leader, tabId };
}
