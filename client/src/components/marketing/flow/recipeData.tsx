/**
 * Automation Recipe Data
 * 
 * Pre-built automation recipe templates for common workflows.
 * Extracted from RecipeSelectorModal for modularity.
 */
import React from 'react';
import { ShoppingCart, Mail, Star, Tag, Gift, Heart } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';

export interface AutomationRecipe {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
    category: string;
    nodes: Omit<Node, 'position'>[];
    edges: Omit<Edge, 'id'>[];
}

export const AUTOMATION_CATEGORIES = ['All', 'Onboarding', 'Sales', 'Engagement', 'Segmentation', 'Retention'] as const;

export type AutomationCategory = typeof AUTOMATION_CATEGORIES[number];

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
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
