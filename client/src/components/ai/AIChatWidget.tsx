import { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Sparkles, ChevronDown, BarChart2, Package, TrendingUp, ShoppingCart, Target } from 'lucide-react';
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

export function AIChatWidget() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: 'welcome', role: 'assistant', content: 'Hi! I can help you analyze your store data. Ask me about **Sales**, **Products**, **Customers**, **Reviews**, or your **Ad Performance**.' }
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
                body: JSON.stringify({ message: userMsg.content })
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

    const suggestedActions = [
        { label: "Store Overview", icon: <BarChart2 size={14} />, query: "Give me a store overview" },
        { label: "Top Products", icon: <TrendingUp size={14} />, query: "What are my best selling products?" },
        { label: "Ad Performance", icon: <Target size={14} />, query: "How are my ads performing?" },
        { label: "Recent Orders", icon: <ShoppingCart size={14} />, query: "Show me the last 5 orders" },
    ];

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

            {/* Chat Window */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden animate-in slide-in-from-bottom-5 fade-in duration-200 font-sans">

                    {/* Header */}
                    <div className="bg-linear-to-r from-blue-600 to-indigo-600 p-4 flex justify-between items-center text-white shadow-md">
                        <div className="flex items-center gap-2">
                            <Bot size={20} />
                            <span className="font-semibold tracking-wide">OverSeek AI</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1 rounded-sm transition-colors">
                            <ChevronDown size={20} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-gray-50/50">
                        {messages.map(msg => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-xs ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-br-none'
                                    : 'bg-white border border-gray-100 text-slate-800 rounded-bl-none'
                                    }`}>

                                    <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : 'prose-slate'}`}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {msg.content}
                                        </ReactMarkdown>
                                    </div>

                                    {/* Sources / Context Data */}
                                    {msg.sources && msg.sources.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-dashed border-gray-200/50">
                                            <p className="text-[10px] uppercase font-bold opacity-50 mb-2">Analyzed Sources</p>
                                            <div className="flex flex-wrap gap-2">
                                                {msg.sources.map((s: any, idx) => (
                                                    <span key={idx} className="text-[10px] bg-black/5 px-2 py-1 rounded-sm truncate max-w-[150px]" title={JSON.stringify(s)}>
                                                        {s.name || s.title || `Order #${s.order_count ? 'Aggregated' : s.id}`}
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
                    <div className="p-3 border-t border-gray-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                        <form onSubmit={(e) => handleSend(e)} className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Ask about orders, products..."
                                className="flex-1 px-4 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/50 focus:bg-white transition-all text-slate-800 placeholder:text-slate-400"
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
