
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { getDateRange } from '../utils/dateUtils';
import { Logger } from '../utils/logger';

import { ReportResult, ReportTemplate } from '../types/analytics';
import { AnalyticsService } from '../services/AnalyticsService';
import { ReportConfigPanel } from './reports/ReportConfigPanel';
import { ReportResults } from './reports/ReportResults';
import { SaveReportModal } from './reports/SaveReportModal';
import type { SaveReportPayload } from './reports/SaveReportModal';

interface ReportBuilderProps {
    initialConfig?: ReportTemplate['config'];
    autoRun?: boolean;
    viewMode?: boolean; // New prop to toggle master-detail viewer style
    onTemplateSaved?: () => void;
}

export function ReportBuilder({ initialConfig, autoRun = false, viewMode = false, onTemplateSaved }: ReportBuilderProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [metrics, setMetrics] = useState<string[]>(initialConfig?.metrics || ['sales']);
    const [dimension, setDimension] = useState(initialConfig?.dimension || 'day');
    const [dateRange, setDateRange] = useState(initialConfig?.dateRange || 'today');
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState<ReportResult[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

    const handleSave = async (data: SaveReportPayload) => {
        if (!currentAccount || !token) return;

        try {
            const newTemplate = await AnalyticsService.saveTemplate(token, currentAccount.id, {
                name: data.name,
                config: { metrics, dimension, dateRange }
            });

            if (data.schedule) {
                await AnalyticsService.createSchedule(token, currentAccount.id, {
                    templateId: newTemplate.id,
                    frequency: data.schedule.frequency,
                    dayOfWeek: data.schedule.dayOfWeek,
                    dayOfMonth: data.schedule.dayOfMonth,
                    time: data.schedule.time,
                    emailRecipients: data.schedule.emailRecipients,
                });
            }

            setIsSaveModalOpen(false);
            if (onTemplateSaved) onTemplateSaved();
        } catch (e) {
            Logger.error('Save failed', { error: e });
            // Optionally set an error state here to show in the modal, 
            // but for now we mirror previous behavior which was just console.error
        }
    };

    const generateReport = useCallback(async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        setError(null);
        setHasSearched(true);
        setResults([]);

        const range = getDateRange(dateRange);

        try {
            Logger.debug('Generating report', { metrics, dimension, startDate: range.startDate, endDate: range.endDate });

            const data = await AnalyticsService.generateReport(token, currentAccount.id, {
                metrics,
                dimension,
                startDate: new Date(range.startDate),
                endDate: new Date(range.endDate)
            });

            setResults(data);
        } catch (error: unknown) {
            Logger.error('Report failed', { error });
            const message = error instanceof Error ? error.message : 'An error occurred while generating the report.';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, token, metrics, dimension, dateRange]);

    useEffect(() => {
        if (initialConfig) {
            setMetrics(initialConfig.metrics);
            setDimension(initialConfig.dimension);
            setDateRange(initialConfig.dateRange);
        }
        // Auto-run if requested and we have a valid initial config (or just defaults)
        if (autoRun) {
            generateReport();
        }
    }, [initialConfig, autoRun, generateReport]);

    return (
        <div className={`space - y - 6 ${viewMode ? 'h-full flex flex-col' : 'bg-white p-6 rounded-xl shadow-xs border border-gray-200'} `}>
            <div className={`flex flex - col md: flex - row gap - 6 ${viewMode ? 'h-full' : ''} `}>

                {/* Configuration Panel - Hidden in View Mode unless toggled (future feature) */}
                {!viewMode && (
                    <ReportConfigPanel
                        dateRange={dateRange}
                        setDateRange={setDateRange}
                        dimension={dimension}
                        setDimension={setDimension}
                        metrics={metrics}
                        setMetrics={setMetrics}
                        isLoading={isLoading}
                        onGenerate={generateReport}
                        onSaveOpen={() => setIsSaveModalOpen(true)}
                    />
                )}

                {/* Results Panel */}
                <ReportResults
                    results={results}
                    metrics={metrics}
                    dimension={dimension}
                    viewMode={viewMode}
                    error={error}
                    hasSearched={hasSearched}
                />
            </div>

            {/* Save Template Modal */}
            <SaveReportModal
                isOpen={isSaveModalOpen}
                onClose={() => setIsSaveModalOpen(false)}
                onSave={handleSave}
            />
        </div>
    );
}

