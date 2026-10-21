import { formatDateTimeSafe } from '../../utils/format';
import { isRecord } from '../../utils/responseValidation';

interface Conversation { id: string; status: string; updatedAt: string; channel: string; messages?: { content: string }[] }
interface Props { conversations: Conversation[]; isLoading?: boolean; onSelectConversation?: (id: string) => void }
export function PreviousConversationsSection({ conversations, isLoading = false, onSelectConversation }: Props) {
    if (isLoading) return <p role="status" className="text-sm text-slate-500 dark:text-slate-400">Loading conversation history...</p>;
    if (!Array.isArray(conversations) || !conversations.every(conversation => isRecord(conversation) && typeof conversation.id === 'string' && typeof conversation.status === 'string' && typeof conversation.channel === 'string')) return <p role="alert">Conversation history unavailable.</p>;
    if (!conversations.length) return <p className="text-sm text-slate-500 dark:text-slate-400">No previous conversations found.</p>;
    return <div className="space-y-2">{conversations.slice(0, 5).map(conversation => {
        const content = Array.isArray(conversation.messages) ? conversation.messages[0]?.content : undefined;
        const preview = typeof content === 'string' && content.trim() ? content.replace(/<[^>]*>/g, '').slice(0, 60) : 'Message preview unavailable';
        const details = <><div className="flex justify-between gap-2 text-xs"><span>{conversation.status} · {conversation.channel}</span><span>{formatDateTimeSafe(typeof conversation.updatedAt === 'string' ? conversation.updatedAt : undefined, 'Date unavailable')}</span></div><p className="text-sm mt-1 break-words">{preview}</p></>;
        const className = 'w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100';
        return onSelectConversation ? <button type="button" key={conversation.id} className={className} onClick={() => onSelectConversation(conversation.id)}>{details}</button> : <div key={conversation.id} className={className}>{details}</div>;
    })}{conversations.length > 5 && <p className="text-xs text-slate-500 dark:text-slate-400">+{conversations.length - 5} more</p>}</div>;
}
