import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { Bot, Send, Loader2, Sparkles, ChevronDown, BarChart2, TrendingUp, ShoppingCart, Target, Users, Search, DollarSign } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    sources?: any[];
}


/** Why memo: AIChatWidget lives in DashboardLayout and has no page-specific props.
 *  Without memo, every route change re-renders it unnecessarily. */
function AIChatWidgetInner() {
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

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async (e?: React.FormEvent, textOverride?: string) => {
        if (e) e.preventDefault();
        const textToSend = textOverride || input;

        if (!textToSend.trim() || !currentAccount) return;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: textToSend };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsThinking(true);

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
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

            if (res.ok) {
                const aiMsg: Message = {
                    id: Date.now().toString() + '_ai',
                    role: 'assistant',
                    content: data.reply,
                    sources: data.sources
                };
                setMessages(prev => [...prev, aiMsg]);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "Sorry, I had trouble reaching the AI. Please try again." }]);
        } finally {
            setIsThinking(false);
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
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-105 z-50 group"
                >
                    <Sparkles size={24} className="group-hover:animate-pulse" />
                </button>
            )}

            {/* Chat Window - Glassmorphism */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 w-[400px] h-[650px] flex flex-col z-50 overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-300 font-sans rounded-3xl shadow-2xl border border-white/20 backdrop-blur-xl bg-white/70">

                    {/* Header */}
                    <div className="bg-white/40 backdrop-blur-md p-4 flex justify-between items-center border-b border-white/20">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
                                <Bot size={18} />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 text-sm leading-tight">OverSeek AI</h3>
                                <p className="text-[10px] text-slate-500 font-medium">Context-Aware Analyst</p>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors text-slate-500">
                            <ChevronDown size={18} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] px-5 py-3 shadow-sm ${msg.role === 'user'
                                    ? 'bg-linear-to-br from-blue-600 to-indigo-600 text-white rounded-2xl rounded-tr-sm'
                                    : 'bg-white/60 backdrop-blur-sm border border-white/40 text-slate-800 rounded-2xl rounded-tl-sm'
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
                                                {msg.sources.map((s: any, idx) => (
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
                            <div className="flex justify-start">
                                <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-none px-4 py-3 shadow-xs flex items-center gap-2">
                                    <Loader2 size={16} className="animate-spin text-blue-600" />
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
                                    key={idx}
                                    onClick={() => handleSend(undefined, action.query)}
                                    className="flex items-center gap-2 whitespace-nowrap px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors shadow-xs"
                                >
                                    {action.icon}
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input */}
                    <div className="p-3 bg-white/40 backdrop-blur-md border-t border-white/20">
                        <form onSubmit={(e) => handleSend(e)} className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Ask about sales, visitors, forecasts..."
                                className="flex-1 px-4 py-3 bg-white/60 backdrop-blur-xl rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/50 focus:bg-white/80 transition-all text-slate-800 placeholder:text-slate-500 shadow-inner border border-white/40"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                disabled={isThinking}
                            />
                            <button
                                type="submit"
                                disabled={!input.trim() || isThinking}
                                className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg active:scale-95"
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
