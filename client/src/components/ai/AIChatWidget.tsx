import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { Bot, Send, Loader2, Sparkles, ChevronDown, BarChart2, TrendingUp, Users, Search, DollarSign } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    sources?: MessageSource[];
}

interface MessageSource {
    name?: string;
    title?: string;
    term?: string;
    [key: string]: unknown;
}

/** Why memo: AIChatWidget lives in DashboardLayout and has no page-specific props.
 *  Without memo, every route change re-renders it unnecessarily. */
function AIChatWidgetInner() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    if (!token || !currentAccount) return null;
    return <AccountAIChat key={JSON.stringify([currentAccount.id, token])} />;
}

function AccountAIChat() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: 'welcome', role: 'assistant', content: 'Hi! I\'m your **Store Analyst**. Ask me about **Sales**, **Live Traffic**, **Profitability**, or valid **Forecasts**.' }
    ]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const request = useRef<AbortController | null>(null);
    const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pending = useRef(false);
    const active = useRef(true);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); if (requestTimer.current) clearTimeout(requestTimer.current); }; }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView?.({ behavior: 'auto' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async (e?: React.FormEvent, textOverride?: string) => {
        if (e) e.preventDefault();
        const textToSend = textOverride || input;

        if (!textToSend.trim() || !currentAccount || !token || pending.current) return;
        pending.current = true; setError(null);
        const controller = new AbortController(); request.current = controller;
        const timeout = setTimeout(() => controller.abort(), 60000);
        requestTimer.current = timeout;

        const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: textToSend.trim() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsThinking(true);

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                },
                body: JSON.stringify({
                    message: userMsg.content,
                    context: { path: location.pathname } // Inject URL context
                })
            });

            const data = await res.json();
            if (!active.current) return;

            if (res.ok) {
                if (typeof data?.reply !== 'string' || !data.reply.trim()) throw new Error('Invalid AI reply');
                const aiMsg: Message = {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: data.reply,
                    sources: Array.isArray(data.sources) ? data.sources.filter((source: unknown) => source && typeof source === 'object').map((source: MessageSource) => ({ name: typeof source.name === 'string' ? source.name : undefined, title: typeof source.title === 'string' ? source.title : undefined, term: typeof source.term === 'string' ? source.term : undefined })) : []
                };
                setMessages(prev => [...prev, aiMsg]);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            if (active.current) { setError('The AI request failed or timed out. Your question is ready to retry.'); setInput(textToSend); }
        } finally {
            clearTimeout(timeout); requestTimer.current = null; pending.current = false;
            if (active.current) setIsThinking(false);
        }
    };

    const suggestedActions = useMemo(() => {
        const path = location.pathname;
        const actions = [
            { label: "Live Traffic", icon: <Users size={14} />, query: "Who is on the site right now?" },
            { label: "Forecast Sales", icon: <TrendingUp size={14} />, query: "Forecast my sales for next week" },
        ];

        if (path.includes('/orders/') && !path.includes('/orders/new')) {
            actions.unshift({ label: "Analyze Order", icon: <DollarSign size={14} />, query: "Is this order profitable?" });
        } else if (path.includes('/inventory/product/')) {
            actions.unshift({ label: "Product Performance", icon: <BarChart2 size={14} />, query: "How is this product performing?" });
        } else if (path.includes('/customers/')) {
            actions.unshift({ label: "Customer Value", icon: <Users size={14} />, query: "Is this a high value customer?" });
        } else {
            actions.push({ label: "Profitability", icon: <DollarSign size={14} />, query: "How profitable were we last month?" });
            actions.push({ label: "Search Terms", icon: <Search size={14} />, query: "What are people searching for?" });
        }

        return actions.slice(0, 4);
    }, [location.pathname]);

    if (!currentAccount) return null;

    return (
        <>
            {/* Trigger Button */}
            {!isOpen && (
                <button
                    type="button" aria-label="Open store analyst" aria-expanded="false"
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 w-12 h-12 bg-[var(--primary-color)] hover:bg-[var(--primary-hover)] text-[var(--primary-foreground)] rounded-xl shadow-sm flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-color)] z-50"
                >
                    <Sparkles size={22} />
                </button>
            )}

            {/* Analyst conversation */}
            {isOpen && (
                <div role="dialog" aria-label="Store analyst" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); setIsOpen(false); } }} className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 w-[min(400px,calc(100vw-1.5rem))] h-[min(650px,calc(100dvh-1.5rem))] flex flex-col z-50 overflow-hidden font-sans rounded-xl shadow-sm border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">

                    {/* Header */}
                    <div className="bg-white dark:bg-slate-900 p-4 flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[var(--primary-color)] flex items-center justify-center text-[var(--primary-foreground)] shadow-sm ">
                                <Bot size={18} />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm leading-tight">OverSeek AI</h3>
                                <p className="text-[10px] text-slate-500 font-medium">Context-Aware Analyst</p>
                            </div>
                        </div>
                        <button type="button" aria-label="Close store analyst" onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors text-slate-500">
                            <ChevronDown size={18} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div role="log" aria-label="Analyst conversation" aria-live="polite" className="flex-1 overflow-y-auto p-4 space-y-6">
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] px-5 py-3 shadow-sm ${msg.role === 'user'
                                    ? 'bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-xl rounded-tr-sm'
                                    : 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl rounded-tl-sm'
                                    }`}>

                                    <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : 'prose-slate'}`}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>

                                    {/* Sources / Context Data */}
                                    {msg.sources && msg.sources.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-dashed border-white/20">
                                            <p className="text-[10px] uppercase font-bold opacity-60 mb-2 flex items-center gap-1">
                                                <Sparkles size={10} /> Analyzed Data
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                {msg.sources.map((s, idx) => (
                                                    <span key={idx} className="text-[10px] bg-black/5 px-2 py-1 rounded-full truncate max-w-[150px] border border-black/5" title={JSON.stringify(s)}>
                                                        {s.name || s.title || s.term || `Item #${idx + 1}`}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {isThinking && (
                            <div role="status" className="flex justify-start">
                                <div className="bg-white border border-gray-100 rounded-xl rounded-bl-none px-4 py-3 shadow-xs flex items-center gap-2">
                                    <Loader2 size={16} className="animate-spin text-[var(--brand-text)]" />
                                    <span className="text-xs text-slate-500 font-medium">Analyzing data...</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Suggestions */}
                    {messages.length < 3 && !isThinking && (
                        <div className="px-4 pb-2 bg-gray-50/50 flex gap-2 overflow-x-auto no-scrollbar">
                            {suggestedActions.map((action, idx) => (
                                <button
                                    type="button"
                                    key={idx}
                                    onClick={() => handleSend(undefined, action.query)}
                                    className="flex items-center gap-2 whitespace-nowrap px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-[var(--brand-subtle)] hover:border-[var(--brand-border)] hover:text-[var(--brand-text)] transition-colors shadow-xs"
                                >
                                    {action.icon}
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input */}
                    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
                        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 mb-2">{error}</p>}
                        <form onSubmit={(e) => handleSend(e)} className="flex gap-2">
                            <input
                                aria-label="Question for store analyst" maxLength={10000}
                                type="text"
                                placeholder="Ask about sales, visitors, forecasts..."
                                className="min-w-0 flex-1 px-3 py-2 bg-white dark:bg-slate-800 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-[var(--focus-color)] text-slate-800 dark:text-slate-100 placeholder:text-slate-500 border border-slate-300 dark:border-slate-600"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                disabled={isThinking}
                            />
                            <button
                                aria-label="Send question"
                                type="submit"
                                disabled={!input.trim() || isThinking}
                                className="w-10 h-10 bg-[var(--primary-color)] text-[var(--primary-foreground)] rounded-lg flex items-center justify-center hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-color)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <Send size={18} />
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}

export const AIChatWidget = memo(AIChatWidgetInner);
