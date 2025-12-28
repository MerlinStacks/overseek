import React, { useState, useRef, useEffect } from 'react';
import { Send, X, Bot, Loader, Sparkles } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useNavigate } from 'react-router-dom';

import { useSettings } from '../context/SettingsContext';
import { createCoupon } from '../services/api';
import './AIChat.css';

// Simple formatter for AI responses
const FormatMessage = ({ text }) => {
    // Split by newlines first
    const lines = text.split('\n');

    return (
        <div>
            {lines.map((line, i) => {
                // Formatting Helpers
                const boldRegex = /\*\*(.*?)\*\*/g;
                const parts = line.split(boldRegex);
                const formattedLine = parts.map((part, index) => {
                    return index % 2 === 1 ? <strong key={index}>{part}</strong> : part;
                });

                // List Items
                if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
                    return (
                        <div key={i} style={{ display: 'flex', marginLeft: '8px' }}>
                            <span style={{ marginRight: '8px' }}>•</span>
                            <span>{formattedLine.slice(2)}</span>
                        </div>
                    );
                }

                // Empty lines
                if (!line.trim()) return <div key={i} style={{ height: '8px' }} />;

                return <div key={i}>{formattedLine}</div>;
            })}
        </div>
    );
};

const AIChat = () => {
    const { settings } = useSettings();
    const [isOpen, setIsOpen] = useState(false);
    const [hasUnread, setHasUnread] = useState(false);
    const [messages, setMessages] = useState([
        { role: 'assistant', text: "Hello! I'm your Store Assistant. Ask me about your orders, products, or sales." }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef(null);
    const navigate = useNavigate();

    // Load data for "AI" context
    const products = useLiveQuery(() => db.products.toArray()) || [];
    const orders = useLiveQuery(() => db.orders.toArray()) || [];

    // Proactive Insights Check (Once on mount/data load)
    useEffect(() => {
        const checkInsights = async () => {
            // Only run if we haven't already added an insight msg
            if (messages.length > 1) return;

            // 1. Check Low Stock
            const lowStock = products.filter(p => p.stock_quantity !== null && p.stock_quantity <= 3);
            if (lowStock.length > 0) {
                setMessages(prev => {
                    if (prev.some(m => m.text.includes('low stock'))) return prev;
                    return [...prev, {
                        role: 'assistant',
                        text: `⚠️ Heads up! You have **${lowStock.length} items** that are critically low on stock (3 or fewer). Check the Inventory page.`
                    }];
                });
                setHasUnread(true);
            }

            // 2. Check Sales Today
            const today = new Date().toISOString().split('T')[0];
            const salesToday = orders.filter(o => o.date_created && o.date_created.startsWith(today));
            if (salesToday.length > 0) {
                const total = salesToday.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
                if (total > 0) {
                    setMessages(prev => {
                        if (prev.some(m => m.text.includes('Sales update'))) return prev;
                        return [...prev, {
                            role: 'assistant',
                            text: `📈 Sales update: You've made **$${total.toFixed(2)}** today from ${salesToday.length} orders.`
                        }];
                    });
                    setHasUnread(true);
                }
            }
        };

        if (products.length && orders.length) {
            checkInsights();
        }
    }, [products.length, orders.length]);

    // Scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen]);

    // Mark read on open
    useEffect(() => {
        if (isOpen) setHasUnread(false);
    }, [isOpen]);


    // Helper for date ranges
    const getOrdersInDateRange = (days) => {
        const now = new Date();
        const start = new Date();
        start.setDate(now.getDate() - days);
        return orders.filter(o => new Date(o.date_created) >= start);
    };

    // Helper to parse natural language dates
    const parseDateQuery = (query) => {
        const lower = query.toLowerCase();
        const now = new Date();
        let start = null;
        let end = null;
        let label = "";

        const yearMatch = lower.match(/\b(20\d{2})\b/);
        const year = yearMatch ? parseInt(yearMatch[1]) : now.getFullYear();

        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const shortMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

        let monthIndex = -1;
        months.forEach((m, i) => { if (lower.includes(m)) monthIndex = i; });
        if (monthIndex === -1) {
            shortMonths.forEach((m, i) => { if (lower.includes(m)) monthIndex = i; });
        }

        if (monthIndex !== -1) {
            start = new Date(year, monthIndex, 1);
            end = new Date(year, monthIndex + 1, 0, 23, 59, 59);
            label = `in ${months[monthIndex].charAt(0).toUpperCase() + months[monthIndex].slice(1)} ${year}`;
        } else if (yearMatch) {
            start = new Date(year, 0, 1);
            end = new Date(year, 11, 31, 23, 59, 59);
            label = `in ${year}`;
        }

        return { start, end, label };
    };

    // --- Tools Definition ---
    const availableTools = [
        {
            name: "create_coupon",
            description: "Create a discount coupon code. Args: { code: string, amount: string, discount_type: 'percent' | 'fixed_cart', description: string }",
            execute: async (args) => {
                if (!settings.storeUrl) return "Error: API not configured.";
                try {
                    const res = await createCoupon(settings, {
                        code: args.code,
                        amount: args.amount,
                        discount_type: args.discount_type || 'percent',
                        description: args.description || 'Created by AI'
                    });
                    await db.coupons.put({ ...res, account_id: 1 });
                    return `Coupon **${res.code}** created successfully! (ID: ${res.id})`;
                } catch (e) {
                    return `Failed to create coupon: ${e.message}`;
                }
            }
        },
        {
            name: "lookup_order",
            description: "Get full details of a specific order by ID. Args: { order_id: number }",
            execute: async (args) => {
                const order = await db.orders.get(parseInt(args.order_id));
                if (!order) return `Order #${args.order_id} not found locally.`;
                return `Order #${order.id} | Status: ${order.status} | Total: ${order.total} ${order.currency}\nItems:\n${order.line_items?.map(i => `- ${i.name} x${i.quantity}`).join('\n')}`;
            }
        },
        {
            name: "check_stock",
            description: "Check exact stock status for a product search term. Args: { name: string }",
            execute: async (args) => {
                const matches = (await db.products.toArray()).filter(p => p.name.toLowerCase().includes(args.name.toLowerCase()));
                if (matches.length === 0) return `No products found matching '${args.name}'.`;
                return `**Stock Check Results:**\n` + matches.map(p => `- ${p.name}: **${p.stock_quantity ?? '∞'}** (Status: ${p.stock_status})`).join('\n');
            }
        },
        {
            name: "list_recent_orders",
            description: "List the most recent 5 orders. Args: {}",
            execute: async () => {
                const recent = await db.orders.orderBy('date_created').reverse().limit(5).toArray();
                return `**Recent Orders:**\n` + recent.map(o => `- Order #${o.id}: **${o.total} ${o.currency}** (${o.status})`).join('\n');
            }
        }
    ];

    const generateSystemPrompt = (context) => `
You are a smart Store Assistant for WooDash.
Current Date: ${new Date().toISOString()}

Context:
${JSON.stringify(context, null, 2)}

You have access to the following TOOLS.
Tool Syntax: [TOOL: tool_name, { "arg": "value" }]

Available Tools:
${availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Rules:
1. Use markdown for formatting (**bold**, - lists).
2. Be concise and professional.
3. If users ask to navigate, use [Nav: /url].
`;

    const processQuery = async (query) => {
        const lowerQuery = query.toLowerCase();

        // --- Navigation ---
        if (lowerQuery.includes('go to') || lowerQuery.includes('open') || lowerQuery.includes('navigate') || lowerQuery.includes('take me')) {
            if (lowerQuery.includes('dashboard') || lowerQuery.includes('home')) { navigate('/'); return "Navigating to Dashboard..."; }
            if (lowerQuery.includes('orders')) { navigate('/orders'); return "Opening Orders page..."; }
            if (lowerQuery.includes('products')) { navigate('/products'); return "Taking you to Products..."; }
            if (lowerQuery.includes('customers')) { navigate('/customers'); return "Opening Customers list..."; }
            if (lowerQuery.includes('settings')) { navigate('/settings'); return "Opening Settings..."; }
            if (lowerQuery.includes('analytics')) { navigate('/analytics'); return "Showing Analytics..."; }
            if (lowerQuery.includes('automations')) { navigate('/automations'); return "Opening Automations..."; }
            if (lowerQuery.includes('carts')) { navigate('/carts'); return "Opening Live Carts..."; }
        }

        // --- Real AI Mode ---
        if (settings.aiApiKey) {
            try {
                const context = {
                    store_stats: {
                        revenue_total: orders.reduce((s, o) => s + parseFloat(o.total || 0), 0).toFixed(2),
                        order_count: orders.length,
                        product_count: products.length
                    }
                };

                const userMsgs = [{ role: 'system', content: generateSystemPrompt(context) }, { role: 'user', content: query }];

                const callAI = async (msgs) => {
                    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${settings.aiApiKey}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': window.location.origin,
                            'X-Title': 'WooDash'
                        },
                        body: JSON.stringify({
                            model: settings.aiModel || 'google/gemini-2.0-flash-exp:free',
                            messages: msgs
                        })
                    });
                    const d = await res.json();
                    if (d.error) throw new Error(d.error.message);
                    return d.choices[0].message.content;
                };

                let text = await callAI(userMsgs);

                // Tool Execution
                const toolMatch = text.match(/\[TOOL:\s*(\w+),\s*({.*?})\]/s);
                if (toolMatch) {
                    const toolName = toolMatch[1];
                    let toolArgs = {};
                    try {
                        toolArgs = JSON.parse(toolMatch[2]);
                    } catch (e) {
                        return "Error parsing tool arguments.";
                    }

                    const tool = availableTools.find(t => t.name === toolName);
                    if (tool) {
                        setMessages(prev => [...prev, { role: 'assistant', text: `_Running tool: ${toolName}..._` }]);
                        const result = await tool.execute(toolArgs);

                        // Re-prompt
                        userMsgs.push({ role: 'assistant', content: text });
                        userMsgs.push({ role: 'system', content: `Tool Result:\n${result}` });
                        text = await callAI(userMsgs);
                    }
                }

                // Nav Hints
                if (text.includes('/orders')) navigate('/orders');
                if (text.includes('/products')) navigate('/products');

                return text;
            } catch (e) {
                console.error("AI Error", e);
                return "I'm having trouble connecting to my brain right now. Please check your API key in Settings.";
            }
        }

        // --- Fallback Rule-Based Logic ---
        let response = "I'm not sure about that. Try asking about **sales**, **orders**, **products**, or tell me to 'go to' a page.";
        const dateQuery = parseDateQuery(query);

        // Sales
        if (lowerQuery.includes('sales') || lowerQuery.includes('revenue') || lowerQuery.includes('made') || lowerQuery.includes('money')) {
            let filteredOrders = orders;
            let timeText = "total";
            if (dateQuery.start) {
                filteredOrders = orders.filter(o => { const d = new Date(o.date_created); return d >= dateQuery.start && d <= dateQuery.end; });
                timeText = dateQuery.label;
            } else if (lowerQuery.includes('last 7 days')) { filteredOrders = getOrdersInDateRange(7); timeText = "last 7 days"; }
            else if (lowerQuery.includes('last 30 days')) { filteredOrders = getOrdersInDateRange(30); timeText = "last 30 days"; }
            else if (lowerQuery.includes('today')) { filteredOrders = getOrdersInDateRange(1); timeText = "today's"; }

            const total = filteredOrders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
            response = `Your revenue **${timeText}** is **$${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}** from ${filteredOrders.length} orders.`;
        }

        // Orders
        else if (lowerQuery.includes('orders') || lowerQuery.includes('how many')) {
            if (lowerQuery.includes('product') || lowerQuery.includes('item')) {
                response = `You have **${products.length}** products in your catalog.`;
            } else {
                response = `You have **${orders.length}** total orders stored locally.`;
            }
        }

        // Stock
        else if (lowerQuery.includes('stock')) {
            const low = products.filter(p => p.stock_quantity !== null && p.stock_quantity < 5);
            if (low.length > 0) response = `Found **${low.length}** items low on stock. \nTop ones:\n` + low.slice(0, 3).map(p => `- ${p.name}`).join('\n');
            else response = "Stock levels look healthy! ✅";
        }

        return response;
    };

    const handleSend = async (e) => {
        if (e) e.preventDefault();
        if (!input.trim()) return;

        const userMsg = { role: 'user', text: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsTyping(true);

        // Simulate slight delay for realism if not using AI
        if (!settings.aiApiKey) await new Promise(r => setTimeout(r, 600));

        const aiResponseText = await processQuery(userMsg.text);

        setIsTyping(false);
        setMessages(prev => [...prev, { role: 'assistant', text: aiResponseText }]);
    };

    const suggestions = [
        "Sales last 30 days",
        "How many orders?",
        "Best selling product?",
        "Show low stock"
    ];

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className={`ai-chat-fab ${hasUnread ? 'pulse' : ''}`}
                title="Store Assistant"
            >
                {hasUnread ? <Sparkles size={24} /> : <Bot size={28} />}
            </button>

            {isOpen && (
                <div className="ai-chat-window">
                    <div className="ai-header">
                        <div className="ai-header-title">
                            <Bot size={20} />
                            <span>Store Assistant</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="ai-close-btn">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="ai-messages">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`ai-message ${msg.role}`}>
                                <FormatMessage text={msg.text} />
                            </div>
                        ))}
                        {isTyping && (
                            <div className="ai-typing">
                                <Loader size={16} className="animate-spin" color="#a855f7" />
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {messages.length < 3 && (
                        <div className="ai-suggestions">
                            {suggestions.map(s => (
                                <button
                                    key={s}
                                    onClick={() => { setInput(s); setTimeout(() => handleSend(), 0); }}
                                    className="ai-suggestion-chip"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}

                    <form onSubmit={handleSend} className="ai-input-area">
                        <input
                            className="ai-input"
                            placeholder="Message AI..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                        />
                        <button type="submit" className="ai-send-btn" disabled={!input.trim()}>
                            <Send size={18} />
                        </button>
                    </form>
                </div>
            )}
        </>
    );
};

export default AIChat;
