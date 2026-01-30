/**
 * ExecutiveReportsPanel - PDF Report Generation
 * 
 * Generates and manages executive marketing performance reports.
 * Part of AI Co-Pilot v2 - Phase 5: Executive Report Generation.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';
import {
    FileText, Download, Trash2, Calendar, Loader2, RefreshCw,
    FileCheck, Sparkles, AlertCircle
} from 'lucide-react';

interface Report {
    id: string;
    periodStart: string;
    periodEnd: string;
    fileName: string;
    fileSize: number;
    createdAt: string;
    downloadUrl: string;
}

export function ExecutiveReportsPanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [reports, setReports] = useState<Report[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);

    // Date range for new report
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [includeAiSummary, setIncludeAiSummary] = useState(true);

    const headers = useCallback(() => ({
        'Authorization': `Bearer ${token}`,
        'X-Account-ID': currentAccount?.id || '',
        'Content-Type': 'application/json'
    }), [token, currentAccount?.id]);

    const fetchReports = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/ads/reports/history', { headers: headers() });
            const data = await res.json();
            setReports(data.reports || []);
        } catch (err) {
            Logger.error('Failed to fetch reports', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, headers]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const handleGenerate = async () => {
        if (!startDate || !endDate) return;

        setIsGenerating(true);
        try {
            const res = await fetch('/api/ads/reports/executive', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    startDate,
                    endDate,
                    includeAiSummary
                })
            });

            if (res.ok) {
                const data = await res.json();
                // Auto-download the report
                if (data.report?.downloadUrl) {
                    window.open(data.report.downloadUrl, '_blank');
                }
                fetchReports();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to generate report');
            }
        } catch (err) {
            Logger.error('Failed to generate report', { error: err });
            alert('Error generating report');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this report permanently?')) return;

        try {
            await fetch(`/api/ads/reports/executive/${id}`, {
                method: 'DELETE',
                headers: headers()
            });
            fetchReports();
        } catch (err) {
            Logger.error('Failed to delete report', { error: err });
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                        <FileText className="text-indigo-600" />
                        Executive Reports
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">Generate PDF performance reports with AI insights</p>
                </div>
                <button
                    onClick={() => fetchReports()}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                    title="Refresh"
                >
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Generate New Report */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Sparkles className="text-indigo-600" size={18} />
                    Generate New Report
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Calendar size={14} className="inline mr-1" />
                            Start Date
                        </label>
                        <input
                            type="date"
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Calendar size={14} className="inline mr-1" />
                            End Date
                        </label>
                        <input
                            type="date"
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            value={endDate}
                            onChange={e => setEndDate(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="aiSummary"
                            checked={includeAiSummary}
                            onChange={e => setIncludeAiSummary(e.target.checked)}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                        />
                        <label htmlFor="aiSummary" className="text-sm text-gray-700">
                            Include AI Summary
                        </label>
                    </div>

                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating || !startDate || !endDate}
                        className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <FileCheck size={18} />
                                Generate PDF
                            </>
                        )}
                    </button>
                </div>

                {isGenerating && (
                    <div className="mt-4 p-3 bg-indigo-100 rounded-lg text-sm text-indigo-800 flex items-center gap-2">
                        <AlertCircle size={16} />
                        This may take a minute. The PDF will download automatically when ready.
                    </div>
                )}
            </div>

            {/* Report History */}
            <div>
                <h3 className="font-semibold text-gray-900 mb-4">Report History</h3>

                {reports.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                        <FileText className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                        <p className="text-gray-500">No reports generated yet</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Period</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Generated</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Size</th>
                                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {reports.map(report => (
                                    <tr key={report.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            <span className="font-medium text-gray-900">
                                                {new Date(report.periodStart).toLocaleDateString()}
                                            </span>
                                            <span className="text-gray-400 mx-2">→</span>
                                            <span className="font-medium text-gray-900">
                                                {new Date(report.periodEnd).toLocaleDateString()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">
                                            {new Date(report.createdAt).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">
                                            {formatFileSize(report.fileSize)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <a
                                                    href={report.downloadUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100"
                                                >
                                                    <Download size={14} />
                                                    Download
                                                </a>
                                                <button
                                                    onClick={() => handleDelete(report.id)}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                                    title="Delete"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
