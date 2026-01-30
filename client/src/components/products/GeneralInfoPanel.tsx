import React, { useState } from 'react';
import { FileText, Building2, Code, Eye, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { RichTextEditor } from '../common/RichTextEditor';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';


interface GeneralInfoPanelProps {
    formData: any;
    product: any;
    suppliers?: any[];
    onChange: (updates: any) => void;
}

/**
 * General product info panel with name, SKU, supplier, and description.
 * Includes AI rewrite functionality for the description field.
 */
export function GeneralInfoPanel({ formData, product, suppliers = [], onChange }: GeneralInfoPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [viewMode, setViewMode] = useState<'visual' | 'code'>('visual');
    const [isRewriting, setIsRewriting] = useState(false);
    const [rewriteError, setRewriteError] = useState<string | null>(null);
    const [editorKey, setEditorKey] = useState(0);

    /**
     * Calls the AI rewrite endpoint to generate a new product description.
     * Uses the account's OpenRouter API key and the admin-configured prompt.
     */
    async function handleAIRewrite() {
        if (!token || !currentAccount || !product?.wooId) return;

        setIsRewriting(true);
        setRewriteError(null);

        try {
            const categoryNames = product.categories?.map((c: any) => c.name).join(', ') || '';

            const res = await fetch(`/api/products/${product.wooId}/rewrite-description`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    currentDescription: formData.description || '',
                    productName: formData.name || product.name || '',
                    shortDescription: formData.short_description || '',
                    categories: categoryNames
                })
            });

            // Check content-type before attempting JSON parse
            const contentType = res.headers.get('content-type') || '';

            if (!contentType.includes('application/json')) {
                // Server returned HTML or other non-JSON (likely error page)
                setRewriteError('Server error. Please try again later.');
                return;
            }

            const data = await res.json();

            if (!res.ok) {
                setRewriteError(data.error || 'Failed to rewrite description');
                return;
            }

            if (data.description) {
                onChange({ description: data.description });
                setEditorKey(prev => prev + 1);
            }
        } catch (err: any) {
            setRewriteError(err.message || 'Network error');
        } finally {
            setIsRewriting(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="bg-white/70 backdrop-blur-md rounded-xl shadow-xs border border-white/50 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
                            className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                            <input
                                type="text"
                                value={formData.sku}
                                onChange={(e) => onChange({ sku: e.target.value })}
                                className="w-full px-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                <select
                                    value={formData.supplierId || ''}
                                    onChange={(e) => onChange({ supplierId: e.target.value })}
                                    className="w-full pl-9 pr-3 py-2 bg-white/50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden transition-all appearance-none"
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
                            <div className="flex items-center gap-2">
                                {/* AI Rewrite Button */}
                                <button
                                    onClick={handleAIRewrite}
                                    disabled={isRewriting}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-linear-to-r from-purple-500 to-indigo-500 text-white hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs"
                                    title="Rewrite description using AI"
                                >
                                    {isRewriting ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Sparkles size={14} />
                                    )}
                                    {isRewriting ? 'Rewriting...' : 'AI Rewrite'}
                                </button>

                                {/* View Mode Toggle */}
                                <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
                                    <button
                                        onClick={() => setViewMode('visual')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'visual' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        <Eye size={14} /> Visual
                                    </button>
                                    <button
                                        onClick={() => setViewMode('code')}
                                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'code' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        <Code size={14} /> Code
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Rewrite Error Message */}
                        {rewriteError && (
                            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-sm text-red-700">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <span>{rewriteError}</span>
                            </div>
                        )}

                        {viewMode === 'visual' ? (
                            <div className="bg-white/50 border border-gray-200 rounded-lg overflow-hidden transition-all duration-300">
                                <RichTextEditor
                                    key={editorKey}
                                    variant="standard"
                                    value={formData.description || ''}
                                    onChange={(val: string) => onChange({ description: val })}
                                    features={['bold', 'italic', 'underline', 'link', 'list']}
                                    placeholder="Enter product description..."
                                />
                            </div>
                        ) : (
                            <textarea
                                value={formData.description || ''}
                                onChange={(e) => onChange({ description: e.target.value })}
                                className="w-full h-80 px-4 py-3 bg-slate-900 text-blue-100 font-mono text-xs leading-relaxed rounded-lg border border-slate-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden resize-none shadow-inner"
                                spellCheck={false}
                            />
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
}
