/**
 * Flow Node Types
 * 
 * Type definitions and utility functions for flow nodes.
 */
import {
    Mail, Clock, Split, Zap, MessageSquare, Tag, Link, ShoppingCart,
    CheckCircle, Star, User, Eye, UserPlus, CreditCard, XCircle,
    MousePointer, Target, ArrowUpDown, LogOut
} from 'lucide-react';

/**
 * Node statistics interface for enrollment counts.
 */
export interface NodeStats {
    active: number;
    queued: number;
    completed: number;
    skipped?: number;
    failed?: number;
}

export type OnAddStepCallback = (nodeId: string, position: { x: number; y: number }) => void;
export type OnCopyNodeCallback = (nodeId: string) => void;
export type OnMoveNodeCallback = (nodeId: string) => void;
export type OnDeleteNodeCallback = (nodeId: string) => void;

/**
 * Get icon for trigger type.
 */
export function getTriggerIcon(config: any) {
    const triggerType = config?.triggerType;
    switch (triggerType) {
        case 'ORDER_CREATED': return <ShoppingCart size={16} className="text-white" />;
        case 'ORDER_COMPLETED': return <CheckCircle size={16} className="text-white" />;
        case 'REVIEW_LEFT': return <Star size={16} className="text-white" />;
        case 'ABANDONED_CART': return <ShoppingCart size={16} className="text-white" />;
        case 'CART_VIEWED': return <Eye size={16} className="text-white" />;
        case 'CUSTOMER_SIGNUP': return <UserPlus size={16} className="text-white" />;
        case 'SUBSCRIPTION_CREATED': return <CreditCard size={16} className="text-white" />;
        case 'SUBSCRIPTION_CANCELLED': return <XCircle size={16} className="text-white" />;
        case 'TAG_ADDED':
        case 'TAG_REMOVED': return <Tag size={16} className="text-white" />;
        case 'EMAIL_OPENED': return <Mail size={16} className="text-white" />;
        case 'LINK_CLICKED': return <MousePointer size={16} className="text-white" />;
        case 'MANUAL': return <User size={16} className="text-white" />;
        default: return <Zap size={16} className="text-white" />;
    }
}

/**
 * Get human-readable trigger name.
 */
export function getTriggerLabel(config: any): string {
    const triggerType = config?.triggerType;
    const labels: Record<string, string> = {
        'ORDER_CREATED': 'Order Created',
        'ORDER_COMPLETED': 'Order Completed',
        'REVIEW_LEFT': 'Review Left',
        'ABANDONED_CART': 'Cart Abandoned',
        'CART_VIEWED': 'Cart Viewed',
        'CUSTOMER_SIGNUP': 'Customer Signup',
        'SUBSCRIPTION_CREATED': 'Subscription Created',
        'SUBSCRIPTION_CANCELLED': 'Subscription Cancelled',
        'TAG_ADDED': 'Tag Added',
        'TAG_REMOVED': 'Tag Removed',
        'EMAIL_OPENED': 'Email Opened',
        'LINK_CLICKED': 'Link Clicked',
        'MANUAL': 'Manual Entry',
    };
    return labels[triggerType] || 'Trigger';
}

/**
 * Get icon for action type.
 */
export function getActionIcon(config: any) {
    const actionType = config?.actionType;
    switch (actionType) {
        case 'SEND_EMAIL': return <Mail size={16} className="text-white" />;
        case 'SEND_SMS': return <MessageSquare size={16} className="text-white" />;
        case 'ADD_TAG':
        case 'REMOVE_TAG': return <Tag size={16} className="text-white" />;
        case 'WEBHOOK': return <Link size={16} className="text-white" />;
        case 'GOAL': return <Target size={16} className="text-white" />;
        case 'JUMP': return <ArrowUpDown size={16} className="text-white" />;
        case 'EXIT': return <LogOut size={16} className="text-white" />;
        default: return <Mail size={16} className="text-white" />;
    }
}

/**
 * Get human-readable action name.
 */
export function getActionLabel(config: any): string {
    const actionType = config?.actionType;
    const labels: Record<string, string> = {
        'SEND_EMAIL': 'Send Email',
        'SEND_SMS': 'Send SMS',
        'ADD_TAG': 'Add Tag',
        'REMOVE_TAG': 'Remove Tag',
        'WEBHOOK': 'Webhook',
        'GOAL': 'Goal',
        'JUMP': 'Jump',
        'EXIT': 'Exit',
    };
    return labels[actionType] || 'Action';
}

/**
 * Get gradient color for action type.
 */
export function getActionGradient(config: any): string {
    const actionType = config?.actionType;
    switch (actionType) {
        case 'GOAL': return 'bg-linear-to-br from-emerald-500 to-emerald-600';
        case 'JUMP': return 'bg-linear-to-br from-red-500 to-red-600';
        case 'EXIT': return 'bg-linear-to-br from-gray-500 to-gray-600';
        default: return 'bg-linear-to-br from-green-500 to-green-600';
    }
}
