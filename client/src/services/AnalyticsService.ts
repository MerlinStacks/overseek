import { api } from './api';
import { ReportResult, ReportTemplate } from '../types/analytics';

export const AnalyticsService = {
    generateReport: async (
        token: string,
        accountId: string,
        payload: { metrics: string[], dimension: string, startDate: Date, endDate: Date }
    ): Promise<ReportResult[]> => {
        return api.post<ReportResult[]>('/api/analytics/custom-report', payload, token, accountId);
    },

    saveTemplate: async (
        token: string,
        accountId: string,
        template: { name: string, config: any }
    ): Promise<ReportTemplate> => {
        return api.post<ReportTemplate>('/api/analytics/templates', template, token, accountId);
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
        }
    ): Promise<void> => {
        return api.post<void>('/api/analytics/schedules', schedule, token, accountId);
    }
};
