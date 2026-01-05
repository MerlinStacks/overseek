import React from 'react';
import { BarChart3, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ReportResult } from '../../types/analytics';

interface ReportResultsProps {
    results: ReportResult[];
    metrics: string[];
    dimension: string;
    viewMode: boolean;
    error: string | null;
    hasSearched: boolean;
}

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
        const headers = ['Dimension', ...metrics];
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
        link.setAttribute("download", `custom_report_${new Date().toISOString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportPDF = () => {
        if (results.length === 0) return;
        const doc = new jsPDF();
        doc.text("Custom Report", 14, 15);
        const tableColumn = ["Dimension", ...metrics.map(m => m.toUpperCase())];
        const tableRows = results.map(row => [
            row.dimension,
            ...metrics.map(m => {
                const val = (row as any)[m] || 0;
                return typeof val === 'number' ? val.toFixed(2) : val;
            })
        ]);
        autoTable(doc, { head: [tableColumn], body: tableRows, startY: 20 });
        doc.save(`custom_report_${new Date().toISOString()}.pdf`);
    };

    return (
        <div className={`flex-1 min-h-[400px] flex flex-col ${viewMode ? 'bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-sm p-6' : ''}`}>
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    {viewMode && <BarChart3 className="text-blue-600" size={24} />}
                    {viewMode ? 'Report Analysis' : 'Results'}
                </h3>
                <div className="flex gap-2">
                    <button onClick={exportCSV} disabled={results.length === 0} className="btn-secondary flex items-center gap-2">
                        <Download size={16} /> CSV
                    </button>
                    <button onClick={exportPDF} disabled={results.length === 0} className="btn-secondary flex items-center gap-2">
                        <Download size={16} /> PDF
                    </button>
                </div>
            </div>

            {error ? (
                <div className="h-full flex flex-col items-center justify-center text-red-500 bg-red-50 rounded-xl p-10">
                    <p className="font-semibold">Error generating report</p>
                    <p className="text-sm mt-2">{error}</p>
                </div>
            ) : results.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50 p-10">
                    <BarChart3 size={48} className="mb-4 text-gray-300" />
                    <p>{hasSearched ? 'No results found for the selected criteria' : 'Select metrics and generate a report'}</p>
                </div>
            ) : (
                <div className="overflow-x-auto border rounded-lg shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                                    {dimension === 'product' ? 'Product Name' : dimension.toUpperCase()}
                                </th>
                                {metrics.map(m => (
                                    <th key={m} className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        {m}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {results.map((row, i) => (
                                <tr key={i} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {row.dimension}
                                    </td>
                                    {metrics.map(m => (
                                        <td key={m} className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right font-mono">
                                            {m === 'sales' || m === 'aov'
                                                ? `$${((row as any)[m] || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                                                : ((row as any)[m] || 0)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
