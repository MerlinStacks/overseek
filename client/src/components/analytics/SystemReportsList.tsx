import * as React from 'react';
import { BarChart3, Trash2 } from 'lucide-react';
import { ReportTemplate } from '../../types/analytics';

interface SystemReportsListProps {
    templates: ReportTemplate[];
    onSelect: (template: ReportTemplate) => void;
    onDelete: (e: React.MouseEvent, id: string) => void;
}

export function SystemReportsList({ templates, onSelect, onDelete }: SystemReportsListProps) {
    const systemTemplates = templates.filter(t => t.type.includes('SYSTEM'));
    const customTemplates = templates.filter(t => t.type === 'CUSTOM');

    return (
        <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Premade & Saved Reports</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* System Reports Section */}
                <div className="col-span-full">
                    <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">System Reports</h4>
                </div>

                {systemTemplates.map(t => (
                    <div
                        key={t.id}
                        onClick={() => onSelect(t)}
                        className="p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md cursor-pointer transition-all group"
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <BarChart3 size={20} />
                            </div>
                        </div>
                        <h4 className="font-bold text-gray-900 group-hover:text-blue-600 mb-1">{t.name}</h4>
                        <p className="text-sm text-gray-500">
                            Group by {t.config.dimension.toUpperCase()} • {t.config.dateRange}
                        </p>
                    </div>
                ))}

                {/* Custom Reports Section */}
                {customTemplates.length > 0 && (
                    <>
                        <div className="col-span-full mt-6">
                            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">My Saved Templates</h4>
                        </div>
                        {customTemplates.map(t => (
                            <div
                                key={t.id}
                                className="relative p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md cursor-pointer transition-all group"
                            >
                                <div onClick={() => onSelect(t)}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="p-2 bg-purple-50 text-purple-600 rounded-lg group-hover:bg-purple-600 group-hover:text-white transition-colors">
                                            <BarChart3 size={20} />
                                        </div>
                                    </div>
                                    <h4 className="font-bold text-gray-900 group-hover:text-blue-600 mb-1">{t.name}</h4>
                                    <p className="text-sm text-gray-500">
                                        Group by {t.config.dimension.toUpperCase()} • {t.config.dateRange}
                                    </p>
                                </div>
                                <button
                                    onClick={(e) => onDelete(e, t.id)}
                                    className="absolute top-4 right-4 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 rounded-sm"
                                    title="Delete Template"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
