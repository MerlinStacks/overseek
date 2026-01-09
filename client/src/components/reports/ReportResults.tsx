import * as React from 'react';
import { BarChart3, Download, FileText, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReportResult, METRIC_OPTIONS } from '../../types/analytics';

interface ReportResultsProps {
    results: ReportResult[];
    metrics: string[];
    dimension: string;
    viewMode: boolean;
    error: string | null;
    hasSearched: boolean;
}

/** Format value based on metric type */
const formatValue = (metric: string, value: number | undefined): string => {
    if (value === undefined || value === null) return '-';

    const metricInfo = METRIC_OPTIONS.find(m => m.value === metric);
    const format = metricInfo?.format || 'number';

    switch (format) {
        case 'currency':
            return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        case 'percent':
            return `${value.toFixed(1)}%`;
        default:
            return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
};

/** Get dimension display label */
const getDimensionLabel = (dimension: string): string => {
    const labels: Record<string, string> = {
        day: 'Date',
        month: 'Month',
        product: 'Product',
        category: 'Category',
        customer: 'Customer',
        customer_segment: 'Segment',
        traffic_source: 'Traffic Source',
        utm_source: 'UTM Source',
        device: 'Device',
        country: 'Country',
        order_status: 'Order Status'
    };
    return labels[dimension] || dimension.toUpperCase();
};

/** Get metric display label */
const getMetricLabel = (metric: string): string => {
    const metricInfo = METRIC_OPTIONS.find(m => m.value === metric);
    return metricInfo?.label || metric.toUpperCase();
};

export function ReportResults({
    results,
    metrics,
    dimension,
    viewMode,
    error,
    hasSearched
}: ReportResultsProps) {

    const exportCSV = () => {
        if (results.length === 0) return;
        const headers = [getDimensionLabel(dimension), ...metrics.map(getMetricLabel)];
        const rows = results.map(row => [
            row.dimension,
            ...metrics.map(m => (row as any)[m] || 0)
        ]);

        const csvContent = "data:text/csv;charset=utf-8,"
            + headers.join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `report_${dimension}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportPDF = () => {
        if (results.length === 0) return;
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text(`Report: ${getDimensionLabel(dimension)}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 28);

        const tableColumn = [getDimensionLabel(dimension), ...metrics.map(getMetricLabel)];
        const tableRows = results.map(row => [
            row.dimension,
            ...metrics.map(m => formatValue(m, (row as any)[m]))
        ]);

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 35,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [59, 130, 246] }
        });

        doc.save(`report_${dimension}_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    // Calculate totals for summary
    const totals = metrics.reduce((acc, m) => {
        acc[m] = results.reduce((sum, row) => sum + ((row as any)[m] || 0), 0);
        return acc;
    }, {} as Record<string, number>);

    return (
        <div className={`flex-1 min-h-[400px] flex flex-col ${viewMode ? 'bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg p-6' : ''}`}>

            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        {viewMode && <BarChart3 className="text-blue-600" size={24} />}
                        {viewMode ? 'Report Analysis' : 'Results'}
                    </h3>
                    {results.length > 0 && (
                        <p className="text-sm text-gray-500 mt-1">
                            {results.length} rows • Grouped by {getDimensionLabel(dimension)}
                        </p>
                    )}
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={exportCSV}
                        disabled={results.length === 0}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs"
                    >
                        <Download size={14} /> CSV
                    </button>
                    <button
                        onClick={exportPDF}
                        disabled={results.length === 0}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs"
                    >
                        <FileText size={14} /> PDF
                    </button>
                </div>
            </div>

            {/* Error State */}
            {error ? (
                <div className="h-full flex flex-col items-center justify-center text-red-600 bg-red-50 rounded-xl p-10 border border-red-100">
                    <AlertCircle size={48} className="mb-4 opacity-70" />
                    <p className="font-semibold text-lg">Error generating report</p>
                    <p className="text-sm mt-2 text-red-500 max-w-md text-center">{error}</p>
                </div>
            ) : results.length === 0 ? (
                /* Empty State */
                <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50 p-10">
                    <BarChart3 size={48} className="mb-4 text-gray-300" />
                    <p className="font-medium">{hasSearched ? 'No results found for the selected criteria' : 'Select metrics and generate a report'}</p>
                    {!hasSearched && <p className="text-sm mt-2">Choose your dimensions and metrics on the left, then click Generate</p>}
                </div>
            ) : (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                        {metrics.slice(0, 4).map(m => {
                            const metricInfo = METRIC_OPTIONS.find(mi => mi.value === m);
                            return (
                                <div key={m} className="bg-linear-to-br from-gray-50 to-white p-4 rounded-xl border border-gray-100 shadow-xs">
                                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                        {metricInfo?.label || m}
                                    </div>
                                    <div className="text-xl font-bold text-gray-900">
                                        {formatValue(m, totals[m])}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Data Table */}
                    <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-xs flex-1">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50/80">
                                <tr>
                                    <th className="px-6 py-3.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                                        {getDimensionLabel(dimension)}
                                    </th>
                                    {metrics.map(m => (
                                        <th key={m} className="px-6 py-3.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                                            {getMetricLabel(m)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                                {results.map((row, i) => (
                                    <tr
                                        key={i}
                                        className={`hover:bg-blue-50/30 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {row.dimension}
                                        </td>
                                        {metrics.map(m => (
                                            <td key={m} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 text-right font-mono tabular-nums">
                                                {formatValue(m, (row as any)[m])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                            {/* Table Footer with Totals */}
                            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                                <tr>
                                    <td className="px-6 py-3.5 text-sm font-bold text-gray-900">
                                        Total
                                    </td>
                                    {metrics.map(m => (
                                        <td key={m} className="px-6 py-3.5 text-sm font-bold text-gray-900 text-right font-mono tabular-nums">
                                            {formatValue(m, totals[m])}
                                        </td>
                                    ))}
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
