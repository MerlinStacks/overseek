/**
 * Automation Recipe Data
 * 
 * Pre-built automation recipe templates for common workflows.
 * Extracted from RecipeSelectorModal for modularity.
 */
/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { ShoppingCart, Mail, Star, Tag } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import { compileEmailDesignV2, createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { createBlock } from '../emailDesignerV2/blockFactory';

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

const createRecipeEmailConfig = (subject: string, previewText: string, body: string) => {
    const design = createDefaultEmailDesignV2({ title: subject, previewText, appName: '{{store.name}}' });
    const contentBlock = createBlock('text');

    if (contentBlock.type === 'text') {
        contentBlock.props = {
            html: body,
            align: 'left',
            size: 16,
            lineHeight: 1.65,
        };
    }

    design.document.sections[1] = {
        ...design.document.sections[1],
        name: 'Email Content',
        columns: [{
            ...design.document.sections[1].columns[0],
            blocks: [contentBlock],
        }],
    };

    return {
        actionType: 'SEND_EMAIL',
        templateType: 'visual',
        emailCategory: 'MARKETING',
        to: '{{customer.email}}',
        subject,
        previewText,
        htmlContent: compileEmailDesignV2(design),
        designJson: design,
    };
};

const createReviewRequestEmailConfig = () => {
    const subject = 'How was your order?';
    const previewText = 'Tell us how everything went with your recent order.';
    const design = createDefaultEmailDesignV2({ title: subject, previewText, appName: '{{store.name}}' });
    const introBlock = createBlock('text');
    const reviewBlock = createBlock('review');

    if (introBlock.type === 'text') {
        introBlock.props = {
            html: '<h2>How was your order?</h2><p>Thanks for shopping with us. Tap a star below to start your review, or reply directly to this email with your review and any photos or videos you would like to share.</p><p style="font-size:28px;letter-spacing:6px;line-height:1.4;"><a href="{{review.star1Url}}" style="text-decoration:none;color:#d97706;">★</a><a href="{{review.star2Url}}" style="text-decoration:none;color:#d97706;">★</a><a href="{{review.star3Url}}" style="text-decoration:none;color:#d97706;">★</a><a href="{{review.star4Url}}" style="text-decoration:none;color:#d97706;">★</a><a href="{{review.star5Url}}" style="text-decoration:none;color:#d97706;">★</a></p>',
            align: 'center',
            size: 16,
            lineHeight: 1.65,
        };
    }

    if (reviewBlock.type === 'review') {
        reviewBlock.props = {
            ...reviewBlock.props,
            headline: 'Review {{review.productName}}',
            content: 'Could you take a minute to share your experience with {{review.productName}}?',
            ctaLabel: 'Leave a review',
            ctaHref: '{{review.requestUrl}}',
            showRating: false,
            showReviewer: false,
            showProductName: false,
        };
    }

    design.document.sections[1] = {
        ...design.document.sections[1],
        name: 'Review Request',
        columns: [{
            ...design.document.sections[1].columns[0],
            blocks: [
                introBlock,
                reviewBlock,
            ],
        }],
    };

    return {
        actionType: 'SEND_EMAIL',
        templateType: 'visual',
        emailCategory: 'MARKETING',
        to: '{{customer.email}}',
        subject,
        previewText,
        htmlContent: compileEmailDesignV2(design),
        designJson: design,
    };
};

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
    {
        id: 'welcome_series',
        name: 'Welcome Email Series',
        description: 'Send a welcome email to new customers with a follow-up after 3 days',
        icon: <Mail className="text-blue-500" size={24} />,
        category: 'Onboarding',
        nodes: [
            { id: 'trigger', type: 'trigger', data: { label: 'Customer Created', config: { triggerType: 'CUSTOMER_CREATED' } } },
            { id: 'email1', type: 'action', data: { label: 'Welcome Email', config: createRecipeEmailConfig('Welcome to our store!', 'We are glad you are here.', '<h2>Welcome!</h2><p>Thanks for joining us. We are delighted to have you here.</p>') } },
            { id: 'delay1', type: 'delay', data: { label: 'Wait 3 Days', config: { duration: 3, unit: 'days' } } },
            { id: 'email2', type: 'action', data: { label: 'Follow-up Email', config: createRecipeEmailConfig('Need help getting started?', 'We are here if you need a hand.', '<h2>How are you getting on?</h2><p>Reply to this email if there is anything we can help you with.</p>') } },
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
            { id: 'email1', type: 'action', data: { label: 'Reminder Email', config: createRecipeEmailConfig('You left something behind...', 'Your cart is ready when you are.', '<h2>Your cart is waiting</h2><p>You left items in your cart. Return to the store when you are ready to complete your order.</p>') } },
            { id: 'delay2', type: 'delay', data: { label: 'Wait 24 Hours', config: { duration: 24, unit: 'hours' } } },
            { id: 'email2', type: 'action', data: { label: 'Last Chance Email', config: createRecipeEmailConfig('Your cart is about to expire!', 'A final reminder about the items in your cart.', '<h2>Still interested?</h2><p>This is your final reminder that items are waiting in your cart.</p>') } },
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
            { id: 'email1', type: 'action', data: { label: 'Review Request', config: createReviewRequestEmailConfig() } },
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
            { id: 'exit', type: 'action', data: { label: 'Exit Flow', config: { actionType: 'EXIT' } } },
        ],
        edges: [
            { source: 'trigger', target: 'condition' },
            { source: 'condition', target: 'tag', sourceHandle: 'true' },
            { source: 'condition', target: 'exit', sourceHandle: 'false' },
        ],
    },
];
