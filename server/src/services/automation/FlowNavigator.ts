/**
 * Flow Navigator
 * 
 * Utility functions for navigating automation flows.
 */

import { FlowDefinition } from './types';

const DELAY_MULTIPLIERS: Record<string, number> = {
    'minutes': 60000,
    'hours': 3600000,
    'days': 86400000
};

/**
 * Find the ID of the next node to process based on flow edges.
 */
export function findNextNodeId(
    flow: FlowDefinition,
    currentNodeId: string,
    outcome?: string
): string | null {
    const edges = flow.edges.filter(e => e.source === currentNodeId);

    if (edges.length === 0) return null;

    if (edges.length === 1 && !outcome) {
        return edges[0].target;
    }

    // Handle Conditional Edges
    if (outcome) {
        const match = edges.find(e => e.sourceHandle === outcome || e.id === outcome);
        if (match) return match.target;
    }

    // Fallback: Return first
    return edges[0].target;
}

/**
 * Calculate delay duration in milliseconds from node data.
 */
export function calculateDelayDuration(data: any): number {
    const val = parseInt(data.value || data.duration || '0', 10);
    const unit = data.unit || 'minutes';
    return val * (DELAY_MULTIPLIERS[unit] || 60000);
}

/**
 * Evaluate a condition node against context data.
 */
export function evaluateCondition(data: any, context: any): boolean {
    if (!data || !context) return true;

    const fieldVal = context[data.field];
    const targetVal = data.value;

    switch (data.operator) {
        case 'gt': return fieldVal > targetVal;
        case 'lt': return fieldVal < targetVal;
        case 'eq': return fieldVal == targetVal;
        case 'contains': return String(fieldVal).includes(targetVal);
        default: return true;
    }
}

/**
 * Replace {{variable}} placeholders with values from context.
 */
export function renderTemplate(template: string, context: any): string {
    if (!template) return '';

    return template.replace(/\{\{(.*?)\}\}/g, (match, path) => {
        const keys = path.trim().split('.');
        let value = context;

        for (const key of keys) {
            if (value === undefined || value === null) return '';
            value = value[key];
        }

        return value !== undefined && value !== null ? String(value) : '';
    });
}
