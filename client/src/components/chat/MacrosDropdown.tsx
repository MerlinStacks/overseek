import { useEffect, useRef, useState } from 'react';
import { Zap, ChevronDown, Play } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useClickOutside } from '../../hooks/useClickOutside';

interface Macro { id: string; name: string; color?: string; actions: unknown[] }
interface Props { conversationId: string; onExecuted?: () => void }

export function MacrosDropdown(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount || !props.conversationId) return null;
    return <ScopedMacros key={JSON.stringify([token, currentAccount.id, props.conversationId])} {...props} token={token} accountId={currentAccount.id} />;
}

function ScopedMacros({ conversationId, onExecuted, token, accountId }: Props & { token: string; accountId: string }) {
    const [macros, setMacros] = useState<Macro[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const active = useRef(true); const pending = useRef(false); const request = useRef<AbortController | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
    useEffect(() => {
        active.current = true;
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch('/api/chat/macros', { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId } });
                if (!response.ok) throw new Error('Could not load quick actions.');
                const data = await response.json();
                if (!Array.isArray(data) || !data.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.actions))) throw new Error('Invalid quick actions response.');
                if (!controller.signal.aborted) { setMacros(data); setError(null); }
            } catch { if (!controller.signal.aborted) setError('Could not load quick actions.'); }
            finally { if (!controller.signal.aborted) setLoading(false); }
        })();
        return () => { active.current = false; controller.abort(); request.current?.abort(); };
    }, [accountId, token, loadAttempt]);

    const execute = async (id: string) => {
        if (pending.current) return;
        pending.current = true; setSaving(true); setError(null);
        const controller = new AbortController(); request.current = controller;
        try {
            const response = await fetch(`/api/chat/macros/${encodeURIComponent(id)}/execute`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': accountId }, body: JSON.stringify({ conversationId }) });
            if (!response.ok) throw new Error('Quick action failed.');
            if (active.current && !controller.signal.aborted) {
                setOpen(false); trigger.current?.focus();
                try { void Promise.resolve(onExecuted?.()).catch(() => {}); } catch { /* Execution already succeeded. */ }
            }
        } catch { if (active.current && !controller.signal.aborted) setError('Could not complete the quick action. Check the conversation before retrying.'); }
        finally { pending.current = false; if (active.current) setSaving(false); }
    };

    return <div ref={panel} className="relative" onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    }}>
        <button ref={trigger} type="button" aria-label="Quick actions" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"><Zap size={14} /><ChevronDown size={12} /></button>
        {open && <div className="absolute right-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-20 p-2">
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error} <button type="button" disabled={saving} onClick={() => { setLoading(true); setLoadAttempt(value => value + 1); }}>Reload quick actions</button></p>}
            {loading ? <p role="status">Loading quick actions...</p> : macros.length === 0 && !error ? <p className="text-sm text-gray-500 dark:text-slate-400">No quick actions configured.</p> : macros.map(macro => <button type="button" key={macro.id} disabled={saving} onClick={() => void execute(macro.id)} className="w-full flex items-center gap-2 p-2 text-sm text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 rounded disabled:opacity-50"><Play size={12} aria-hidden="true" /><span className="flex-1 text-left">{macro.name}</span><span className="text-xs">{macro.actions.length} actions</span></button>)}
            {saving && <p role="status">Executing quick action...</p>}
        </div>}
    </div>;
}
