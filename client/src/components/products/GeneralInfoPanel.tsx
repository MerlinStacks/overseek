import React, { useEffect, useState } from 'react';
import { FileText, Building2, Code, Eye } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';


interface GeneralInfoPanelProps {
    formData: any;
    product: any;
    suppliers?: any[];
    onChange: (updates: any) => void;
}

export function GeneralInfoPanel({ formData, product, suppliers = [], onChange }: GeneralInfoPanelProps) {
    const [viewMode, setViewMode] = useState<'visual' | 'code'>('visual');

    return (
        <div className="space-y-6">
            <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-sm border border-white/50 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4 flex items-center gap-2">
                    <FileText size={16} className="text-blue-600" />
                    General Information
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => onChange({ name: e.target.value })}
                            className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                            <input
                                type="text"
                                value={formData.sku}
                                onChange={(e) => onChange({ sku: e.target.value })}
                                className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                <select
                                    value={formData.supplierId || ''}
                                    onChange={(e) => onChange({ supplierId: e.target.value })}
                                    className="w-full pl-9 pr-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all appearance-none"
                                >
                                    <option value="">Select Supplier...</option>
                                    {suppliers.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">Full Description</label>
                            <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
                                <button
                                    onClick={() => setViewMode('visual')}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'visual' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    <Eye size={14} /> Visual
                                </button>
                                <button
                                    onClick={() => setViewMode('code')}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'code' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    <Code size={14} /> Code
                                </button>
                            </div>
                        </div>

                        {viewMode === 'visual' ? (
                            <div className="bg-white/50 border border-gray-200 rounded-lg overflow-hidden transition-all duration-300">
                                <ReactQuill
                                    theme="snow"
                                    value={formData.description || ''}
                                    onChange={(val) => onChange({ description: val })}
                                    className="h-64 mb-12" // mb-12 to account for toolbar
                                />
                            </div>
                        ) : (
                            <textarea
                                value={formData.description || ''}
                                onChange={(e) => onChange({ description: e.target.value })}
                                className="w-full h-80 px-4 py-3 bg-slate-900 text-blue-100 font-mono text-xs leading-relaxed rounded-lg border border-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-none shadow-inner"
                                spellCheck={false}
                            />
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}
