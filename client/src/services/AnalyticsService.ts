import { api } from './api';
import { ReportResult, ReportTemplate } from '../types/analytics';
import { isRecord } from '../utils/responseValidation';

async function post(endpoint: string, token: string, accountId: string, body: unknown, options?: { signal?: AbortSignal }): Promise<unknown> {
    if (!token?.trim() || !accountId?.trim()) throw new Error('Sign in and select an account first.');
    return api.request(endpoint, { method: 'POST', token, accountId, signal: options?.signal, body: JSON.stringify(body) });
}

export const AnalyticsService = {
    generateReport: async (
        token: string,
        accountId: string,
        payload: { metrics: string[], dimension: string, startDate: Date, endDate: Date },
        options?: { signal?: AbortSignal }
    ): Promise<ReportResult[]> => {
        const value = await post('/api/analytics/custom-report', token, accountId, payload, options);
        if (!Array.isArray(value) || !value.every(row => isRecord(row) && typeof row.dimension === 'string' && payload.metrics.every(key => typeof row[key] === 'number' && Number.isFinite(row[key])))) throw new Error('Invalid report response');
        return value;
    },

    saveTemplate: async (
        token: string,
        accountId: string,
        template: { name: string, config: Record<string, unknown> },
        options?: { signal?: AbortSignal }
    ): Promise<ReportTemplate> => {
        const value = await post('/api/analytics/templates', token, accountId, template, options);
        if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !['CUSTOM', 'SYSTEM', 'SYSTEM_CLONE'].includes(String(value.type)) || !isRecord(value.config) || !Array.isArray(value.config.metrics) || !value.config.metrics.every(metric => typeof metric === 'string') || typeof value.config.dimension !== 'string' || typeof value.config.dateRange !== 'string') throw new Error('Invalid template confirmation');
        return value as unknown as ReportTemplate;
    },

    createSchedule: async (
        token: string,
        accountId: string,
        schedule: {
            templateId: string,
            frequency: string,
            dayOfWeek?: number,
            dayOfMonth?: number,
            time: string,
            emailRecipients: string[]
        },
        options?: { signal?: AbortSignal }
    ): Promise<void> => {
        const value = await post('/api/analytics/schedules', token, accountId, schedule, options);
        if (!isRecord(value) || typeof value.id !== 'string' || !value.id) throw new Error('Invalid schedule confirmation');
    }
};
