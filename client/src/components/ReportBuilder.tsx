
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { getDateRange } from '../utils/dateUtils';

import { ReportResult, ReportTemplate } from '../types/analytics';
import { AnalyticsService } from '../services/AnalyticsService';
import { ReportConfigPanel } from './reports/ReportConfigPanel';
import { ReportResults } from './reports/ReportResults';
import { SaveReportModal } from './reports/SaveReportModal';

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
    const [dateRange, setDateRange] = useState(initialConfig?.dateRange || '30d');
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState<ReportResult[]>([]);
    const [hasSearched, setHasSearched] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

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
    }, [initialConfig, autoRun]);

    const handleSave = async (data: { name: string, schedule: any }) => {
        if (!currentAccount || !token) return;

        try {
            const newTemplate = await AnalyticsService.saveTemplate(token, currentAccount.id, {
                name: data.name,
                config: { metrics, dimension, dateRange }
            });

            if (data.schedule) {
                await AnalyticsService.createSchedule(token, currentAccount.id, {
                    templateId: newTemplate.id,
                    ...data.schedule
                });
            }

            setIsSaveModalOpen(false);
            if (onTemplateSaved) onTemplateSaved();
        } catch (e) {
            console.error('Save failed', e);
            // Optionally set an error state here to show in the modal, 
            // but for now we mirror previous behavior which was just console.error
        }
    };

    const generateReport = async () => {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        setError(null);
        setHasSearched(true);
        setResults([]);

        const range = getDateRange(dateRange);

        try {
            console.log('Generating Report with Payload:', { metrics, dimension, startDate: range.startDate, endDate: range.endDate });

            const data = await AnalyticsService.generateReport(token, currentAccount.id, {
                metrics,
                dimension,
                startDate: range.startDate,
                endDate: range.endDate
            });

            setResults(data);
        } catch (error: any) {
            console.error('Report failed', error);
            setError(error.message || 'An error occurred while generating the report.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={`space - y - 6 ${viewMode ? 'h-full flex flex-col' : 'bg-white p-6 rounded-xl shadow-sm border border-gray-200'} `}>
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

