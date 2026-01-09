/**
 * RecipeSelectorModal - Pre-built automation recipe templates.
 * Allows users to quickly start with common automation patterns.
 */
import React, { useState } from 'react';
import { X, Search, ShoppingCart, Mail, Star, Clock, Users, Tag, Gift, Heart } from 'lucide-react';
import { Node, Edge } from '@xyflow/react';

// Recipe definition
interface AutomationRecipe {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
    category: string;
    nodes: Omit<Node, 'position'>[];
    edges: Omit<Edge, 'id'>[];
}

// Pre-built recipes
const RECIPES: AutomationRecipe[] = [
    {
        id: 'welcome_series',
        name: 'Welcome Email Series',
        description: 'Send a welcome email to new customers with a follow-up after 3 days',
        icon: <Mail className="text-blue-500" size={24} />,
        category: 'Onboarding',
        nodes: [
            { id: 'trigger', type: 'trigger', data: { label: 'Customer Signup', config: { triggerType: 'CUSTOMER_SIGNUP' } } },
            { id: 'email1', type: 'action', data: { label: 'Welcome Email', config: { actionType: 'SEND_EMAIL', subject: 'Welcome to our store!' } } },
            { id: 'delay1', type: 'delay', data: { label: 'Wait 3 Days', config: { duration: 3, unit: 'days' } } },
            { id: 'email2', type: 'action', data: { label: 'Follow-up Email', config: { actionType: 'SEND_EMAIL', subject: 'Need help getting started?' } } },
        ],
        edges: [
            { source: 'trigger', target: 'email1' },
            { source: 'email1', target: 'delay1' },
            { source: 'delay1', target: 'email2' },
        ],
    },
    {
        id: 'abandoned_cart',
        name: 'Abandoned Cart Recovery',
        description: 'Recover abandoned carts with timed email reminders',
        icon: <ShoppingCart className="text-orange-500" size={24} />,
        category: 'Sales',
        nodes: [
            { id: 'trigger', type: 'trigger', data: { label: 'Cart Abandoned', config: { triggerType: 'ABANDONED_CART' } } },
            { id: 'delay1', type: 'delay', data: { label: 'Wait 1 Hour', config: { duration: 1, unit: 'hours' } } },
            { id: 'email1', type: 'action', data: { label: 'Reminder Email', config: { actionType: 'SEND_EMAIL', subject: 'You left something behind...' } } },
            { id: 'delay2', type: 'delay', data: { label: 'Wait 24 Hours', config: { duration: 24, unit: 'hours' } } },
            { id: 'email2', type: 'action', data: { label: 'Last Chance Email', config: { actionType: 'SEND_EMAIL', subject: 'Your cart is about to expire!' } } },
        ],
        edges: [
            { source: 'trigger', target: 'delay1' },
            { source: 'delay1', target: 'email1' },
            { source: 'email1', target: 'delay2' },
            { source: 'delay2', target: 'email2' },
        ],
    },
    {
        id: 'review_request',
        name: 'Review Request',
        description: 'Ask for a review after order completion',
        icon: <Star className="text-yellow-500" size={24} />,
        category: 'Engagement',
        nodes: [
            { id: 'trigger', type: 'trigger', data: { label: 'Order Completed', config: { triggerType: 'ORDER_COMPLETED' } } },
            { id: 'delay1', type: 'delay', data: { label: 'Wait 7 Days', config: { duration: 7, unit: 'days' } } },
            { id: 'email1', type: 'action', data: { label: 'Review Request', config: { actionType: 'SEND_EMAIL', subject: 'How was your order?' } } },
        ],
        edges: [
            { source: 'trigger', target: 'delay1' },
            { source: 'delay1', target: 'email1' },
        ],
    },
    {
        id: 'vip_tagging',
        name: 'VIP Customer Tagging',
        description: 'Automatically tag high-value customers based on order total',
        icon: <Tag className="text-purple-500" size={24} />,
        category: 'Segmentation',
        nodes: [
            { id: 'trigger', type: 'trigger', data: { label: 'Order Completed', config: { triggerType: 'ORDER_COMPLETED' } } },
            { id: 'condition', type: 'condition', data: { label: 'Order > $100?', config: { field: 'order.total', operator: 'gt', value: '100' } } },
            { id: 'tag', type: 'action', data: { label: 'Add VIP Tag', config: { actionType: 'ADD_TAG', tagName: 'VIP Customer' } } },
        ],
        edges: [
            { source: 'trigger', target: 'condition' },
            { source: 'condition', target: 'tag', sourceHandle: 'true' },
        ],
    },
    {
        id: 'birthday_offer',
        name: 'Birthday Special Offer',
        description: 'Send a special discount on customer birthdays',
        icon: <Gift className="text-pink-500" size={24} />,
        category: 'Engagement',
        nodes: [
            { id: 'trigger', type: 'trigger', data: { label: 'Birthday Reminder', config: { triggerType: 'BIRTHDAY_REMINDER' } } },
            { id: 'email1', type: 'action', data: { label: 'Birthday Email', config: { actionType: 'SEND_EMAIL', subject: 'Happy Birthday! Here\'s a gift for you 🎂' } } },
        ],
        edges: [
            { source: 'trigger', target: 'email1' },
        ],
    },
    {
        id: 'win_back',
        name: 'Win-Back Campaign',
        description: 'Re-engage customers who haven\'t purchased in 90 days',
        icon: <Heart className="text-red-500" size={24} />,
        category: 'Retention',
        nodes: [
            { id: 'trigger', type: 'trigger', data: { label: 'Manual Entry', config: { triggerType: 'MANUAL' } } },
            { id: 'email1', type: 'action', data: { label: 'We Miss You', config: { actionType: 'SEND_EMAIL', subject: 'We miss you! Come back for 20% off' } } },
            { id: 'delay1', type: 'delay', data: { label: 'Wait 7 Days', config: { duration: 7, unit: 'days' } } },
            { id: 'email2', type: 'action', data: { label: 'Last Chance', config: { actionType: 'SEND_EMAIL', subject: 'Last chance: Your exclusive discount expires soon' } } },
        ],
        edges: [
            { source: 'trigger', target: 'email1' },
            { source: 'email1', target: 'delay1' },
            { source: 'delay1', target: 'email2' },
        ],
    },
];

const CATEGORIES = ['All', 'Onboarding', 'Sales', 'Engagement', 'Segmentation', 'Retention'];

interface RecipeSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (recipe: AutomationRecipe) => void;
}

export const RecipeSelectorModal: React.FC<RecipeSelectorModalProps> = ({
    isOpen,
    onClose,
    onSelect,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('All');

    const filteredRecipes = RECIPES.filter(recipe => {
        const matchesSearch = recipe.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            recipe.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = activeCategory === 'All' || recipe.category === activeCategory;
        return matchesSearch && matchesCategory;
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Start from a Recipe</h2>
                        <p className="text-sm text-gray-500">Choose a pre-built automation to get started quickly</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search recipes..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 w-48"
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

                {/* Category Tabs */}
                <div className="flex gap-2 px-6 py-3 border-b bg-gray-50">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setActiveCategory(cat)}
                            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${activeCategory === cat
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>

                {/* Recipe Grid */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-2 gap-4">
                        {filteredRecipes.map(recipe => (
                            <button
                                key={recipe.id}
                                onClick={() => {
                                    onSelect(recipe);
                                    onClose();
                                }}
                                className="flex items-start gap-4 p-4 border rounded-xl hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left group"
                            >
                                <div className="p-2 bg-gray-100 rounded-lg group-hover:bg-white transition-colors">
                                    {recipe.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-medium text-gray-900 group-hover:text-blue-700 transition-colors">
                                        {recipe.name}
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                                        {recipe.description}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-sm">
                                            {recipe.nodes.length} steps
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            {recipe.category}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                    {filteredRecipes.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                            No recipes found matching "{searchQuery}"
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
                    <span className="text-sm text-gray-500">{RECIPES.length} recipes available</span>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                    >
                        Start from Scratch
                    </button>
                </div>
            </div>
        </div>
    );
};

export type { AutomationRecipe };
