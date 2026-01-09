/**
 * ActionSelectorModal - Categorized action selector modal.
 * Similar to EventSelectorModal but for selecting actions (Send Email, SMS, etc.)
 */
import React, { useState, useMemo } from 'react';
import { X, Search, MessageSquare, Zap, ShoppingCart, Users, Send, Database } from 'lucide-react';

// Action category definitions
const ACTION_CATEGORIES = [
    { id: 'messaging', label: 'Messaging', icon: MessageSquare },
    { id: 'automations', label: 'Automations', icon: Zap },
    { id: 'woocommerce', label: 'WooCommerce', icon: ShoppingCart },
    { id: 'crm', label: 'CRM', icon: Users },
    { id: 'data', label: 'Send Data', icon: Send },
] as const;

// Actions organized by category
const ACTIONS_BY_CATEGORY: Record<string, { subcategory?: string; actions: ActionItem[] }[]> = {
    messaging: [
        {
            subcategory: 'Email',
            actions: [
                { id: 'SEND_EMAIL', label: 'Send Email', icon: '✉️' },
            ]
        },
        {
            subcategory: 'SMS',
            actions: [
                { id: 'SEND_SMS', label: 'Send SMS', icon: '📱' },
            ]
        },
    ],
    automations: [
        {
            subcategory: 'Tags',
            actions: [
                { id: 'ADD_TAG', label: 'Add Tag', icon: '🏷️' },
                { id: 'REMOVE_TAG', label: 'Remove Tag', icon: '🏷️' },
            ]
        },
        {
            subcategory: 'Lists',
            actions: [
                { id: 'ADD_TO_LIST', label: 'Add to List', icon: '📋' },
                { id: 'REMOVE_FROM_LIST', label: 'Remove from List', icon: '📋' },
            ]
        },
        {
            subcategory: 'Flow Control',
            actions: [
                { id: 'MOVE_TO_AUTOMATION', label: 'Move to Automation', icon: '➡️' },
                { id: 'REMOVE_FROM_AUTOMATION', label: 'Remove from Automation', icon: '⏹️' },
            ]
        },
    ],
    woocommerce: [
        {
            subcategory: 'Orders',
            actions: [
                { id: 'UPDATE_ORDER_STATUS', label: 'Update Order Status', icon: '📦' },
                { id: 'ADD_ORDER_NOTE', label: 'Add Order Note', icon: '📝' },
            ]
        },
        {
            subcategory: 'Coupons',
            actions: [
                { id: 'GENERATE_COUPON', label: 'Generate Coupon', icon: '🎟️' },
            ]
        },
    ],
    crm: [
        {
            actions: [
                { id: 'UPDATE_CUSTOMER', label: 'Update Customer', icon: '👤' },
                { id: 'CREATE_TASK', label: 'Create Task', icon: '✅' },
                { id: 'CREATE_NOTE', label: 'Create Internal Note', icon: '📝' },
            ]
        },
    ],
    data: [
        {
            actions: [
                { id: 'WEBHOOK', label: 'Send Webhook', icon: '🔗' },
                { id: 'HTTP_REQUEST', label: 'HTTP Request', icon: '🌐' },
            ]
        },
    ],
};

interface ActionItem {
    id: string;
    label: string;
    icon: string;
}

interface ActionSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (action: { actionType: string; label: string }) => void;
}

export const ActionSelectorModal: React.FC<ActionSelectorModalProps> = ({
    isOpen,
    onClose,
    onSelect,
}) => {
    const [activeCategory, setActiveCategory] = useState<string>('messaging');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAction, setSelectedAction] = useState<ActionItem | null>(null);

    // Filter actions by search query
    const filteredActions = useMemo(() => {
        const categoryActions = ACTIONS_BY_CATEGORY[activeCategory] || [];
        if (!searchQuery.trim()) return categoryActions;

        const query = searchQuery.toLowerCase();
        return categoryActions.map(group => ({
            ...group,
            actions: group.actions.filter(a => a.label.toLowerCase().includes(query))
        })).filter(g => g.actions.length > 0);
    }, [activeCategory, searchQuery]);

    const handleDone = () => {
        if (selectedAction) {
            onSelect({ actionType: selectedAction.id, label: selectedAction.label });
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Select an Action</h2>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent w-40"
                            />
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Category Sidebar */}
                    <div className="w-44 bg-gray-50 border-r py-2 overflow-y-auto">
                        {ACTION_CATEGORIES.map((cat) => {
                            const Icon = cat.icon;
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => {
                                        setActiveCategory(cat.id);
                                        setSelectedAction(null);
                                    }}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${activeCategory === cat.id
                                        ? 'bg-white text-blue-600 font-medium border-r-2 border-blue-600'
                                        : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                >
                                    <Icon size={16} />
                                    {cat.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Actions List */}
                    <div className="flex-1 p-5 overflow-y-auto">
                        {filteredActions.map((group, idx) => (
                            <div key={idx} className="mb-5 last:mb-0">
                                {group.subcategory && (
                                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                        {group.subcategory}
                                    </h3>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    {group.actions.map((action) => (
                                        <button
                                            key={action.id}
                                            onClick={() => setSelectedAction(action)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-full transition-all ${selectedAction?.id === action.id
                                                ? 'bg-blue-50 border-blue-400 text-blue-700 ring-2 ring-blue-200'
                                                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                                                }`}
                                        >
                                            <span>{action.icon}</span>
                                            {action.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {filteredActions.length === 0 && (
                            <div className="text-center text-gray-500 py-8">
                                No actions found matching "{searchQuery}"
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleDone}
                        disabled={!selectedAction}
                        className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
