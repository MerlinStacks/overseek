import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAccount } from '../context/AccountContext';
import { useSettings } from '../context/SettingsContext';
import {
    Send, User, Search, Paperclip, Smile, MoreHorizontal,
    CheckCircle, Clock, MapPin, Globe, Circle, MessageCircle, Zap, Package,
    Edit2, Save, X
} from 'lucide-react';
import { toast } from 'sonner';
import EmojiPicker from 'emoji-picker-react';
import { fetchChatMessages, sendChatMessage } from '../services/api';

const ContactList = ({
    activeAccount,
    contacts,
    conversations,
    selectedConversationId,
    onSelectConversation
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('open'); // 'open', 'resolved'

    const filteredConversations = conversations?.filter(c => {
        const contact = contacts?.find(Co => Co.id === c.contact_id);
        if (!contact) return false;

        const statusMatch = filterStatus === 'all' ? true : (c.status || 'open') === filterStatus;

        if (searchTerm) {
            const name = (contact.name || '').toLowerCase();
            const email = (contact.email || '').toLowerCase();
            const term = searchTerm.toLowerCase();
            return statusMatch && (name.includes(term) || email.includes(term));
        }
        return statusMatch;
    }).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

    return (
        <div className="inbox-sidebar glass-panel" style={{
            width: '320px', display: 'flex', flexDirection: 'column',
            borderRight: '1px solid var(--border-glass)', borderRadius: '12px 0 0 12px',
            padding: 0, overflow: 'hidden'
        }}>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-glass)' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MessageCircle size={20} /> Inbox
                </h2>

                {/* Status Tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button
                        onClick={() => setFilterStatus('open')}
                        style={{
                            flex: 1, padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                            background: filterStatus === 'open' ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                            color: filterStatus === 'open' ? 'white' : 'var(--text-muted)',
                            fontSize: '0.85rem', fontWeight: '500'
                        }}
                    >
                        Active
                    </button>
                    <button
                        onClick={() => setFilterStatus('resolved')}
                        style={{
                            flex: 1, padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                            background: filterStatus === 'resolved' ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                            color: filterStatus === 'resolved' ? 'white' : 'var(--text-muted)',
                            fontSize: '0.85rem', fontWeight: '500'
                        }}
                    >
                        Resolved
                    </button>
                </div>

                <div style={{ position: 'relative' }}>
                    <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
                    <input
                        className="input-field"
                        placeholder="Search chats..."
                        style={{ paddingLeft: '32px', width: '100%', background: 'rgba(0,0,0,0.2)' }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {filteredConversations?.map(conv => {
                    const contact = contacts?.find(c => c.id === conv.contact_id);
                    const isSelected = selectedConversationId === conv.id;
                    const isUnread = conv.unread_count > 0;

                    return (
                        <div
                            key={conv.id}
                            onClick={() => onSelectConversation(conv.id)}
                            style={{
                                padding: '12px 16px',
                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                cursor: 'pointer',
                                background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                                borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ fontWeight: isUnread ? 'bold' : '500', color: isUnread ? '#fff' : 'var(--text-main)' }}>
                                    {contact?.name || contact?.email || 'Visitor'}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                    {conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{
                                    fontSize: '0.85rem', color: 'var(--text-muted)',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px'
                                }}>
                                    {conv.status === 'resolved' ? <span style={{ color: 'var(--success)' }}><CheckCircle size={10} style={{ display: 'inline' }} /> Resolved</span> : 'Active'}
                                </span>
                                {isUnread && (
                                    <span className="badge badge-danger" style={{ borderRadius: '50%', padding: '2px 6px', fontSize: '0.7rem' }}>
                                        {conv.unread_count}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const ChatWindow = ({ activeAccount, conversation, contact, isTyping, onResolve, onBack, onSendMessage }) => {
    // ... (existing queries)

    // New: Product Query
    const products = useLiveQuery(
        () => activeAccount ? db.products.where({ account_id: activeAccount.id }).toArray() : [],
        [activeAccount],
        []
    );

    const [inputText, setInputText] = useState('');
    const [showEmoji, setShowEmoji] = useState(false);
    const [showSavedReplies, setShowSavedReplies] = useState(false);
    const [showProductPicker, setShowProductPicker] = useState(false);
    const [productSearch, setProductSearch] = useState('');
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const messages = useLiveQuery(
        () => conversation ? db.messages.where({ conversation_id: conversation.id }).sortBy('created_at') : [],
        [conversation],
        []
    );

    const savedReplies = useLiveQuery(
        () => activeAccount ? db.saved_replies.where({ account_id: activeAccount.id }).toArray() : [],
        [activeAccount],
        []
    );

    const handleInputChange = (e) => {
        const val = e.target.value;
        setInputText(val);
        if (val === '/') {
            setShowSavedReplies(true);
        } else if (showSavedReplies && !val.includes('/')) {
            setShowSavedReplies(false);
        }
    };

    const handleSelectCannedResponse = (reply) => {
        setInputText(reply.content);
        setShowSavedReplies(false);
    };

    const handleAddSavedReply = async () => {
        const shortcut = prompt("Enter shortcut keyword (e.g. 'hello'):");
        if (!shortcut) return;
        const content = prompt("Enter the full response text:");
        if (!content) return;

        await db.saved_replies.add({
            account_id: activeAccount.id,
            shortcut,
            content
        });
        toast.success("Saved reply added!");
    };

    const handleProductShare = async (product) => {
        const productContent = `:::PRODUCT:::${JSON.stringify({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image
        })}`;

        try {
            await db.messages.add({
                account_id: activeAccount.id,
                conversation_id: conversation.id,
                sender: 'agent',
                content: productContent,
                created_at: new Date().toISOString(),
                read: 1
            });
            await db.conversations.update(conversation.id, {
                last_message_at: new Date().toISOString()
            });
        } catch (e) {
            console.error(e);
            toast.error("Failed to share product");
        }
        setShowProductPicker(false);
    };

    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(productSearch.toLowerCase())
    );

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
        // Mark as read if user is viewing
        if (conversation && conversation.unread_count > 0) {
            db.conversations.update(conversation.id, { unread_count: 0 });
        }
    }, [messages, conversation]);

    // Sound notification moved to InboxPage for global handling
    useEffect(() => {
        scrollToBottom();
        // Mark as read if user is viewing
        if (conversation && conversation.unread_count > 0) {
            db.conversations.update(conversation.id, { unread_count: 0 });
        }
    }, [messages, conversation]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (onSendMessage) {
            onSendMessage(inputText, setInputText, setShowEmoji);
        }
    };

    const handleEmojiClick = (emojiData) => {
        setInputText(prev => prev + emojiData.emoji);
        // Don't close picker automatically, good for multi-emoji
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            toast.info("File upload feature is coming soon.");
            // Actual upload implementation requires a backend endpoint which is currently pending.
        }
    };

    if (!conversation) {
        return (
            <div className="glass-panel" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-muted)' }}>
                <MessageCircle size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                <h3>Select a conversation</h3>
            </div>
        );
    }

    return (
        <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, borderRadius: 0, borderLeft: 'none', borderRight: 'none' }}>
            {/* Header */}
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
                    }}>
                        {contact?.name?.[0] || <User size={20} />}
                    </div>
                    <div>
                        <div style={{ fontWeight: 'bold' }}>{contact?.name || 'Visitor'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Circle size={8} fill={contact ? "#10b981" : "#64748b"} stroke="none" />
                            {contact ? 'Online' : 'Offline'}
                        </div>
                    </div>
                </div>
                <div>
                    <button className="btn btn-secondary" onClick={onResolve} style={{ marginRight: '8px' }}>
                        <CheckCircle size={16} /> Resolve
                    </button>
                    <button className="btn-icon">
                        <MoreHorizontal size={18} />
                    </button>
                </div>
            </div>

            {/* Messages Area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {messages?.map(msg => {
                    const isAgent = msg.sender === 'agent';

                    let content = msg.content;
                    let isProduct = false;
                    let productData = null;

                    if (typeof content === 'string' && content.startsWith(':::PRODUCT:::')) {
                        try {
                            isProduct = true;
                            productData = JSON.parse(content.replace(':::PRODUCT:::', ''));
                        } catch (e) {
                            content = "Error loading product card.";
                        }
                    }

                    return (
                        <div key={msg.id} style={{ alignSelf: isAgent ? 'flex-end' : 'flex-start', maxWidth: '70%' }}>
                            <div style={{
                                padding: isProduct ? '0' : '12px 16px',
                                borderRadius: isAgent ? '12px 12px 0 12px' : '12px 12px 12px 0',
                                background: isProduct ? 'transparent' : (isAgent ? 'var(--primary)' : 'rgba(255,255,255,0.1)'),
                                color: isAgent ? '#fff' : 'var(--text-main)',
                                boxShadow: isProduct ? 'none' : '0 2px 4px rgba(0,0,0,0.1)',
                                overflow: 'hidden'
                            }}>
                                {isProduct ? (
                                    <div style={{
                                        width: '240px', background: 'rgba(30,30,40,0.95)', border: '1px solid var(--border-glass)',
                                        borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                                    }}>
                                        <div style={{ height: '140px', background: '#333' }}>
                                            {productData.image && <img src={productData.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                        </div>
                                        <div style={{ padding: '12px' }}>
                                            <div style={{ fontSize: '0.95rem', fontWeight: 'bold', marginBottom: '4px', color: '#fff' }}>{productData.name}</div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <div style={{ color: 'var(--primary)', fontWeight: 'bold' }}>
                                                    {productData.price ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(productData.price) : '-'}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ID: {productData.id}</div>
                                            </div>
                                            <button className="btn btn-primary" style={{ width: '100%', fontSize: '0.8rem', padding: '6px' }}>
                                                View Product
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    content
                                )}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', textAlign: isAgent ? 'right' : 'left' }}>
                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    );
                })}


                {isTyping && (
                    <div key="typing" style={{ alignSelf: 'flex-start', maxWidth: '70%' }}>
                        <div style={{
                            padding: '12px 16px',
                            borderRadius: '12px 12px 12px 0',
                            background: 'rgba(255,255,255,0.1)',
                            color: 'var(--text-muted)',
                            display: 'flex', gap: '4px', alignItems: 'center'
                        }}>
                            <span className="dot-animate" style={{ animationDelay: '0s' }}>•</span>
                            <span className="dot-animate" style={{ animationDelay: '0.2s' }}>•</span>
                            <span className="dot-animate" style={{ animationDelay: '0.4s' }}>•</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Typing...
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div style={{ padding: '16px', borderTop: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.2)', position: 'relative' }}>
                {/* Emoji Picker Popover */}
                {showEmoji && (
                    <div style={{ position: 'absolute', bottom: '80px', right: '20px', zIndex: 10 }}>
                        <EmojiPicker
                            onEmojiClick={handleEmojiClick}
                            theme="dark"
                            searchDisabled={false}
                            width={300}
                            height={400}
                        />
                    </div>
                )}

                {/* Canned Responses Popover */}
                {showSavedReplies && (
                    <div className="glass-panel" style={{
                        position: 'absolute', bottom: '80px', left: '20px', zIndex: 10,
                        width: '300px', maxHeight: '400px', overflowY: 'auto',
                        padding: '0', display: 'flex', flexDirection: 'column'
                    }}>
                        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Saved Replies</h4>
                            <button className="btn btn-sm btn-primary" onClick={handleAddSavedReply} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                                + New
                            </button>
                        </div>
                        {savedReplies?.length > 0 ? (
                            savedReplies.map(reply => (
                                <div
                                    key={reply.id}
                                    className="canned-item"
                                    onClick={() => handleSelectCannedResponse(reply)}
                                    style={{
                                        padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)',
                                        display: 'flex', flexDirection: 'column', gap: '4px'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: 'var(--primary)' }}>/{reply.shortcut}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {reply.content}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                No saved replies yet. Type '/' to trigger.
                            </div>
                        )}
                    </div>
                )}

                {/* Product Picker Popover */}
                {showProductPicker && (
                    <div className="glass-panel" style={{
                        position: 'absolute', bottom: '80px', left: '60px', zIndex: 11,
                        width: '320px', maxHeight: '400px', overflowY: 'auto',
                        padding: '0', display: 'flex', flexDirection: 'column'
                    }}>
                        <div style={{ padding: '12px', borderBottom: '1px solid var(--border-glass)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <Search size={16} color="var(--text-muted)" />
                            <input
                                autoFocus
                                className="input-field"
                                style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                                placeholder="Search products..."
                                value={productSearch}
                                onChange={e => setProductSearch(e.target.value)}
                            />
                        </div>
                        {filteredProducts.length > 0 ? (
                            filteredProducts.map(prod => (
                                <div
                                    key={prod.id}
                                    className="canned-item"
                                    onClick={() => handleProductShare(prod)}
                                    style={{
                                        padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)',
                                        display: 'flex', gap: '12px', alignItems: 'center'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <div style={{ width: '40px', height: '40px', background: '#333', borderRadius: '4px', overflow: 'hidden' }}>
                                        {prod.image && <img src={prod.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>{prod.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>
                                            {prod.price}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                No products found.
                            </div>
                        )}
                    </div>
                )}

                <form onSubmit={handleSend} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                    />
                    <button
                        type="button"
                        className="btn-icon"
                        style={{ color: 'var(--text-muted)' }}
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach File"
                    >
                        <Paperclip size={20} />
                    </button>

                    <button
                        type="button"
                        className="btn-icon"
                        style={{ color: showSavedReplies ? 'var(--primary)' : 'var(--text-muted)' }}
                        onClick={() => { setShowSavedReplies(!showSavedReplies); setShowProductPicker(false); }}
                        title="Saved Replies (/)"
                    >
                        <Zap size={20} />
                    </button>

                    <button
                        type="button"
                        className="btn-icon"
                        style={{ color: showProductPicker ? 'var(--primary)' : 'var(--text-muted)' }}
                        onClick={() => { setShowProductPicker(!showProductPicker); setShowSavedReplies(false); }}
                        title="Share Product"
                    >
                        <Package size={20} />
                    </button>

                    <input
                        className="input-field"
                        placeholder="Type a message... (type / for shortcuts)"
                        style={{ flex: 1 }}
                        value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={(e) => {
                            if (e.key === 'Tab' && showSavedReplies && savedReplies.length > 0) {
                                e.preventDefault();
                                handleSelectCannedResponse(savedReplies[0]);
                            }
                        }}
                        autoFocus
                    />


                    <button
                        type="button"
                        className="btn-icon"
                        style={{ color: showEmoji ? 'var(--primary)' : 'var(--text-muted)' }}
                        onClick={() => setShowEmoji(!showEmoji)}
                        title="Insert Emoji"
                    >
                        <Smile size={20} />
                    </button>

                    <button type="submit" className="btn btn-primary" style={{ padding: '0 16px' }}>
                        <Send size={18} />
                    </button>
                </form>
            </div>
        </div>
    );
};

import { fetchCarts } from '../services/api';
import { ShoppingBag, ChevronRight, ExternalLink, ShoppingCart } from 'lucide-react';

const UserDetails = ({ contact }) => {
    const { settings } = useSettings();
    const [orders, setOrders] = useState([]);
    const [cart, setCart] = useState(null);
    const [loadingData, setLoadingData] = useState(false);

    // Edit Mode State
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({ name: '', email: '', location: '' });

    // Notes State
    const [notes, setNotes] = useState('');
    const [isSavingNotes, setIsSavingNotes] = useState(false);

    const handleSaveContact = async () => {
        if (!contact) return;
        try {
            await db.contacts.update(contact.id, {
                name: editForm.name,
                email: editForm.email,
                location: editForm.location
            });
            toast.success("Contact updated");
            setIsEditing(false);
        } catch (e) {
            console.error("Failed to update contact", e);
            toast.error("Update failed");
        }
    };

    const handleSaveNotes = async () => {
        if (!contact) return;
        setIsSavingNotes(true);
        try {
            await db.contacts.update(contact.id, { internal_notes: notes });
            toast.success("Notes saved");
        } catch (e) {
            console.error(e);
            toast.error("Failed to save notes");
        } finally {
            setIsSavingNotes(false);
        }
    };

    useEffect(() => {
        const loadUserData = async () => {
            if (!contact || !contact.email) {
                setOrders([]);
                setCart(null);
                setEditForm({ name: '', email: '', location: '' });
                setNotes('');
                return;
            }

            // Sync form and notes
            setEditForm({
                name: contact.name || '',
                email: contact.email || '',
                location: contact.location || ''
            });
            setNotes(contact.internal_notes || '');
            setIsEditing(false);

            setLoadingData(true);
            try {
                // 1. Fetch Orders from local DB
                const allOrders = await db.orders
                    .where({ account_id: contact.account_id })
                    .reverse()
                    .limit(50)
                    .toArray();

                const userOrders = allOrders.filter(o =>
                    o.billing?.email?.toLowerCase() === contact.email.toLowerCase()
                ).slice(0, 5);

                setOrders(userOrders);

                // 2. Fetch Active Cart from API
                if (settings.storeUrl) {
                    try {
                        const cartsData = await fetchCarts(settings);
                        if (Array.isArray(cartsData)) {
                            const userCart = cartsData.find(c =>
                                c.customer?.email?.toLowerCase() === contact.email.toLowerCase()
                            );
                            setCart(userCart || null);
                        }
                    } catch (e) {
                        console.warn("Failed to fetch carts in inbox", e);
                    }
                }

            } catch (err) {
                console.error(err);
            } finally {
                setLoadingData(false);
            }
        };

        loadUserData();
    }, [contact, settings]);

    if (!contact) return <div className="glass-panel" style={{ width: '280px', borderRadius: '0 12px 12px 0' }} />;

    return (
        <div className="glass-panel" style={{
            width: '320px', borderRadius: '0 12px 12px 0', borderLeft: '1px solid var(--border-glass)',
            padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto'
        }}>
            {/* Profile Header */}
            <div style={{ textAlign: 'center', position: 'relative' }}>
                <div style={{ position: 'absolute', right: 0, top: 0 }}>
                    {!isEditing ? (
                        <button className="btn-icon" onClick={() => setIsEditing(true)} title="Edit Contact">
                            <Edit2 size={16} />
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="btn-icon" onClick={handleSaveContact} style={{ color: 'var(--success)' }} title="Save">
                                <Save size={16} />
                            </button>
                            <button className="btn-icon" onClick={() => setIsEditing(false)} style={{ color: 'var(--danger)' }} title="Cancel">
                                <X size={16} />
                            </button>
                        </div>
                    )}
                </div>

                <div style={{
                    width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto 12px',
                    background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <User size={40} />
                </div>

                {!isEditing ? (
                    <>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{contact.name || 'Visitor'}</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{contact.email || 'No email provided'}</p>
                    </>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input
                            className="input-field"
                            style={{ padding: '4px 8px', textAlign: 'center' }}
                            value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            placeholder="Name"
                        />
                        <input
                            className="input-field"
                            style={{ padding: '4px 8px', textAlign: 'center', fontSize: '0.85rem' }}
                            value={editForm.email}
                            onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                            placeholder="Email"
                        />
                    </div>
                )}
            </div>

            {/* MagicMap Context */}
            <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MapPin size={14} /> MagicMap
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                        <Globe size={16} color="var(--primary)" />
                        <span>{contact.location || 'Unknown Location'}</span>
                    </div>
                    {cart ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--success)' }}>
                            <Circle size={10} fill="currentColor" />
                            <span>Browsing: Checkout</span>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            <Circle size={10} />
                            <span>Browsing: Homepage</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        <Clock size={14} />
                        <span>Online now</span>
                    </div>
                </div>
            </div>

            {/* Internal Notes */}
            <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Edit2 size={14} /> Private Notes</span>
                    {notes !== (contact.internal_notes || '') && (
                        <button
                            onClick={handleSaveNotes}
                            disabled={isSavingNotes}
                            style={{
                                background: 'none', border: 'none', color: 'var(--primary)',
                                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold'
                            }}
                        >
                            {isSavingNotes ? 'Saving...' : 'Save'}
                        </button>
                    )}
                </h4>
                <textarea
                    className="input-field"
                    style={{
                        width: '100%', minHeight: '80px', fontSize: '0.85rem', padding: '8px',
                        resize: 'vertical', background: 'rgba(0,0,0,0.2)'
                    }}
                    placeholder="Add private notes about this customer..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                />
            </div>

            {cart && (
                <div style={{ background: 'rgba(236, 72, 153, 0.1)', border: '1px solid rgba(236, 72, 153, 0.2)', borderRadius: '8px', padding: '12px' }}>
                    <h4 style={{ fontSize: '0.9rem', color: '#ec4899', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ShoppingCart size={14} /> Active Cart
                    </h4>
                    <div style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                        {cart.items.length} items • <strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: cart.currency }).format(cart.total)}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {cart.items.slice(0, 3).map((item, i) => (
                            <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {item.qty}x {item.name}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Recent Orders Section */}
            <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Recent Orders
                </h4>
                {loadingData ? (
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>Loading history...</p>
                ) : orders.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {orders.map(order => (
                            <div key={order.id} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px'
                            }}>
                                <div>
                                    <div style={{ fontWeight: '500', fontSize: '0.9rem' }}>#{order.id}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(order.date_created).toLocaleDateString()}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency }).format(order.total)}
                                    </div>
                                    <div className={`badge ${order.status === 'completed' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.65rem', padding: '2px 6px', display: 'inline-block' }}>
                                        {order.status}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-muted" style={{ fontSize: '0.85rem', fontStyle: 'italic' }}>No previous orders found.</p>
                )}
            </div>

            {/* Meta Info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-glass)', paddingTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
                    <MapPin size={14} color="var(--primary)" />
                    <span>{contact.location || 'Unknown Location'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
                    <Globe size={14} color="var(--primary)" />
                    <span>{contact.ip || 'Unknown IP'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
                    <Clock size={14} color="var(--primary)" />
                    <span>{contact.last_seen ? new Date(contact.last_seen).toLocaleString() : 'Never'}</span>
                </div>
            </div>

            {/* MagicMap */}
            <div style={{ marginTop: 'auto', padding: '12px', background: 'rgba(255,165,0,0.1)', borderRadius: '8px', border: '1px solid rgba(255,165,0,0.2)' }}>
                <h4 style={{ fontSize: '0.85rem', color: '#fbbf24', marginBottom: '6px' }}>MagicMap</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    User is browsing <strong>/products/hoodie-v2</strong>
                </p>
            </div>
        </div>
    );
};

// --- Main Page ---

const InboxPage = () => {
    const { activeAccount } = useAccount();
    const { settings } = useSettings();
    const [selectedConversationId, setSelectedConversationId] = useState(null);
    const [typingConversationId, setTypingConversationId] = useState(null);

    // Queries
    const conversations = useLiveQuery(
        () => activeAccount ? db.conversations.where({ account_id: activeAccount.id }).toArray() : [],
        [activeAccount]
    );

    const contacts = useLiveQuery(
        () => activeAccount ? db.contacts.where({ account_id: activeAccount.id }).toArray() : [],
        [activeAccount]
    );

    const selectedConversation = conversations?.find(c => c.id === selectedConversationId);
    const selectedContact = contacts?.find(c => c.id === selectedConversation?.contact_id);

    // ... (previous code)

    // Notification Permission
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // Monitor for new unread messages (Global Notification)
    const [prevUnreadCount, setPrevUnreadCount] = useState(0);

    useEffect(() => {
        if (!conversations) return;

        const totalUnread = conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0);

        if (totalUnread > prevUnreadCount) {
            // Check if we are focusing on the page? Even if focusing, a notification is fine or just sound.
            // If document.hidden, definitely notify.

            // Sound
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => { });

            // Browser Notification
            if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
                new Notification('New Message', {
                    body: 'You have a new message in Inbox',
                    icon: '/favicon.ico' // or similar
                });
            }
        }
        setPrevUnreadCount(totalUnread);
    }, [conversations]);



    // Real API Polling
    useEffect(() => {
        if (!activeAccount || !settings.storeUrl) return;

        const pollMessages = async () => {
            // Avoid polling if sync is heavy or offline? (optional optimization)
            try {
                const lastSyncKey = `chat_last_sync_${activeAccount.id}`;
                const lastSync = localStorage.getItem(lastSyncKey);
                const params = lastSync ? { after: lastSync } : {};

                const newMessages = await fetchChatMessages(settings, params);

                if (newMessages && newMessages.length > 0) {
                    // Process incoming messages
                    // Expected format: [{ id, contact_email, contact_name, content, direction, created_at }]

                    for (const msg of newMessages) {
                        // 1. Find or Create Contact
                        let contactId;
                        const existingContact = await db.contacts.where({ account_id: activeAccount.id, email: msg.contact_email }).first();

                        if (existingContact) {
                            contactId = existingContact.id;
                            // Update online status?
                        } else {
                            contactId = await db.contacts.add({
                                account_id: activeAccount.id,
                                name: msg.contact_name || 'Visitor',
                                email: msg.contact_email,
                                location: null,
                                created_at: new Date().toISOString()
                            });
                        }

                        // 2. Find or Create Conversation
                        let conv = await db.conversations.where({ account_id: activeAccount.id, contact_id: contactId }).first();
                        let convId;

                        if (!conv) {
                            convId = await db.conversations.add({
                                account_id: activeAccount.id,
                                contact_id: contactId,
                                status: 'open',
                                last_message_at: msg.created_at,
                                unread_count: 0
                            });
                        } else {
                            convId = conv.id;
                        }

                        // 3. Add Message if not exists
                        const exists = await db.messages.where({ account_id: activeAccount.id, remote_id: msg.id }).first();
                        if (!exists) {
                            await db.messages.add({
                                account_id: activeAccount.id,
                                conversation_id: convId,
                                remote_id: msg.id, // Make sure to store remote ID to avoid dupes
                                sender: msg.direction === 'inbound' ? 'visitor' : 'agent',
                                content: msg.content,
                                created_at: msg.created_at,
                                read: 0
                            });

                            // Update unread count if inbound
                            if (msg.direction === 'inbound') {
                                await db.conversations.where('id').equals(convId).modify(c => {
                                    c.unread_count = (c.unread_count || 0) + 1;
                                    c.last_message_at = msg.created_at;
                                    c.status = 'open'; // Re-open if they reply
                                });
                                toast("New message from " + (msg.contact_name || 'Visitor'));
                            }
                        }
                    }

                    // Update Sync Time
                    localStorage.setItem(lastSyncKey, new Date().toISOString());
                }

            } catch (e) {
                // Silent Poll Fail
            }
        };

        const interval = setInterval(pollMessages, 5000); // 5s poll
        return () => clearInterval(interval);
    }, [activeAccount, settings]);

    // Cleanup Simulator
    useEffect(() => {
        // We are removing the simulator entirely as requested.
    }, []);

    // handleSend is now passed as a prop to ChatWindow
    const handleSend = async (inputText, setInputText, setShowEmoji) => {
        if (!inputText.trim()) return;

        const text = inputText;
        setInputText(''); // Optimistic Clear
        setShowEmoji(false);

        try {
            // Optimistic UI Update
            await db.messages.add({
                account_id: activeAccount.id,
                conversation_id: selectedConversation.id, // Use selectedConversation
                sender: 'agent',
                content: text,
                created_at: new Date().toISOString(),
                read: 1,
                pending: true // Flag to show "sending..." state if we wanted
            });

            await db.conversations.update(selectedConversation.id, { // Use selectedConversation
                last_message_at: new Date().toISOString()
            });

            // Send to Network
            await sendChatMessage(settings, {
                contact_email: selectedContact.email, // Use selectedContact
                content: text
            });

        } catch (error) {
            console.error("Failed to send message", error);
            toast.error("Failed to send message. Checked internet?");
            // Optionally mark message as failed in UI
        }
    };

    return (
        <div className="page-container" style={{ height: 'calc(100vh - 80px)', overflow: 'hidden' }}>
            {/* Removing page-header to maximise chat space */}
            <div style={{ display: 'flex', height: '100%', gap: '16px' }}>

                <ContactList
                    activeAccount={activeAccount}
                    contacts={contacts}
                    conversations={conversations}
                    selectedConversationId={selectedConversationId}
                    onSelectConversation={setSelectedConversationId}
                />

                <ChatWindow
                    activeAccount={activeAccount}
                    conversation={selectedConversation}
                    contact={selectedContact}
                    isTyping={typingConversationId === selectedConversationId}
                    onSendMessage={handleSend}
                    onResolve={() => {
                        if (selectedConversation) {
                            db.conversations.update(selectedConversation.id, { status: 'resolved' });
                            setSelectedConversationId(null);
                            toast.success("Conversation resolved");
                        }
                    }}
                />

                <UserDetails contact={selectedContact} />

            </div>
        </div>
    );
};

export default InboxPage;
