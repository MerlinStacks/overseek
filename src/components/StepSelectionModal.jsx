import React, { useState, useMemo } from 'react';
import { Search, Zap, Mail, GitBranch, Clock, Percent, Upload, Tag, Send, MessageSquare, User, ShoppingCart, CreditCard } from 'lucide-react';
import { createPortal } from 'react-dom';

const CATEGORIES = [
    { id: 'all', label: 'All Steps' },
    { id: 'messaging', label: 'Messaging' },
    { id: 'logic', label: 'Logic & Flow' },
    { id: 'woocommerce', label: 'WooCommerce' },
    { id: 'crm', label: 'CRM & Users' }
];

const STEPS = [
    { type: 'action', subType: 'email', label: 'Send Email', icon: Mail, cat: 'messaging', desc: 'Send a designed email to the customer.' },
    { type: 'wait', label: 'Time Delay', icon: Clock, cat: 'logic', desc: 'Wait for a set amount of time.' },
    { type: 'condition', label: 'Condition', icon: GitBranch, cat: 'logic', desc: 'Branch based on order total or other rules.' },
    { type: 'split', label: 'Random Split', icon: Percent, cat: 'logic', desc: 'A/B Test your flow paths.' },
    { type: 'action', subType: 'tag', label: 'Add Tag', icon: Tag, cat: 'crm', desc: 'Add a tag to the customer profile.' },
    { type: 'action', subType: 'webhook', label: 'Webhook', icon: Send, cat: 'crm', desc: 'Send data to an external URL.' },
    { type: 'action', subType: 'user', label: 'Update User', icon: User, cat: 'crm', desc: 'Update customer metadata.' },
    { type: 'action', subType: 'sms', label: 'Send SMS', icon: MessageSquare, cat: 'messaging', desc: 'Send a text message.' },
];

export default function StepSelectionModal({ isOpen, onClose, onSelect }) {
    const [activeCat, setActiveCat] = useState('all');
    const [search, setSearch] = useState('');

    if (!isOpen) return null;

    const filteredSteps = STEPS.filter(step => {
        const matchesCat = activeCat === 'all' || step.cat === activeCat;
        const matchesSearch = step.label.toLowerCase().includes(search.toLowerCase());
        return matchesCat && matchesSearch;
    });

    return createPortal(
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
            <div className="step-modal-content" onClick={e => e.stopPropagation()}>
                <div className="step-modal-header">
                    <h3>Select Next Step</h3>
                    <div className="step-search">
                        <Search size={16} />
                        <input
                            autoFocus
                            placeholder="Search actions..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                </div>

                <div className="step-modal-body">
                    {/* Categories Sidebar */}
                    <div className="step-categories">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                className={`cat-btn ${activeCat === cat.id ? 'active' : ''}`}
                                onClick={() => setActiveCat(cat.id)}
                            >
                                {cat.label}
                            </button>
                        ))}
                    </div>

                    {/* Grid */}
                    <div className="step-grid">
                        {filteredSteps.map((step, i) => (
                            <button
                                key={i}
                                className="step-card-btn"
                                onClick={() => onSelect(step)}
                            >
                                <div className="step-icon-wrapper" style={{ color: '#8b5cf6' }}>
                                    <step.icon size={24} />
                                </div>
                                <div className="step-info">
                                    <span className="step-name">{step.label}</span>
                                    <span className="step-desc">{step.desc}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
