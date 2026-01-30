/**
 * ExperimentsPanel - A/B Testing Experiments Management
 * 
 * Displays and manages creative A/B experiments for ad accounts.
 * Part of AI Co-Pilot v2 - Phase 4: Creative A/B Engine.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';
import {
    FlaskConical, Plus, RefreshCw, Play, Pause, Trophy, BarChart3,
    ChevronRight, AlertCircle, CheckCircle2, Clock, Loader2
} from 'lucide-react';

interface Experiment {
    id: string;
    name: string;
    status: string;
    platform: string;
    primaryMetric: string;
    minSampleSize: number;
    confidenceLevel: number;
    createdAt: string;
    variants?: Variant[];
}

interface Variant {
    id: string;
    variantLabel: string;
    isControl: boolean;
    status: string;
    impressions: number;
    clicks: number;
    ctr: number;
    conversions: number;
    pValue: number | null;
    isSignificant: boolean;
}

interface SignificanceResult {
    hasWinner: boolean;
    winnerId?: string;
    recommendation: string;
    variants: {
        id: string;
        label: string;
        metricValue: number;
        pValue: number | null;
        isSignificant: boolean;
    }[];
}

export function ExperimentsPanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [experiments, setExperiments] = useState<Experiment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<SignificanceResult | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showCreate, setShowCreate] = useState(false);

    const headers = useCallback(() => ({
        'Authorization': `Bearer ${token}`,
        'X-Account-ID': currentAccount?.id || '',
        'Content-Type': 'application/json'
    }), [token, currentAccount?.id]);

    const fetchExperiments = useCallback(async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/ads/experiments', { headers: headers() });
            const data = await res.json();
            setExperiments(data.experiments || []);
        } catch (err) {
            Logger.error('Failed to fetch experiments', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, headers]);

    useEffect(() => {
        fetchExperiments();
    }, [fetchExperiments]);

    const handleAnalyze = async (id: string) => {
        setIsAnalyzing(true);
        setSelectedId(id);
        try {
            const res = await fetch(`/api/ads/experiments/${id}/analyze`, {
                method: 'POST',
                headers: headers()
            });
            const data = await res.json();
            setAnalysis(data.analysis);
        } catch (err) {
            Logger.error('Failed to analyze experiment', { error: err });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handlePause = async (id: string) => {
        try {
            await fetch(`/api/ads/experiments/${id}/pause`, {
                method: 'POST',
                headers: headers()
            });
            fetchExperiments();
        } catch (err) {
            Logger.error('Failed to pause experiment', { error: err });
        }
    };

    const handleResume = async (id: string) => {
        try {
            await fetch(`/api/ads/experiments/${id}/resume`, {
                method: 'POST',
                headers: headers()
            });
            fetchExperiments();
        } catch (err) {
            Logger.error('Failed to resume experiment', { error: err });
        }
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            'RUNNING': 'bg-green-100 text-green-700',
            'PAUSED': 'bg-amber-100 text-amber-700',
            'CONCLUDED': 'bg-blue-100 text-blue-700',
            'DRAFT': 'bg-gray-100 text-gray-600'
        };
        const icons: Record<string, React.ReactNode> = {
            'RUNNING': <Play size={12} />,
            'PAUSED': <Pause size={12} />,
            'CONCLUDED': <Trophy size={12} />,
            'DRAFT': <Clock size={12} />
        };
        return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${styles[status] || styles['DRAFT']}`}>
                {icons[status] || icons['DRAFT']}
                {status}
            </span>
        );
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
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                        <FlaskConical className="text-indigo-600" />
                        A/B Experiments
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">Test creative variants and find winners automatically</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => fetchExperiments()}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                        title="Refresh"
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
                    >
                        <Plus size={18} />
                        New Experiment
                    </button>
                </div>
            </div>

            {/* Experiments List */}
            {experiments.length === 0 ? (
                <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <FlaskConical className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Experiments Yet</h3>
                    <p className="text-gray-500 mb-4">Create your first A/B test to optimize ad performance</p>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                    >
                        <Plus size={18} />
                        Create Experiment
                    </button>
                </div>
            ) : (
                <div className="grid gap-4">
                    {experiments.map(exp => (
                        <div
                            key={exp.id}
                            className="bg-white rounded-xl border border-gray-200 shadow-xs p-5 hover:border-indigo-300 transition-colors"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <h3 className="font-semibold text-gray-900">{exp.name}</h3>
                                        {getStatusBadge(exp.status)}
                                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                            {exp.platform.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 text-sm text-gray-500">
                                        <span>Metric: <strong className="text-gray-700">{exp.primaryMetric.toUpperCase()}</strong></span>
                                        <span>Variants: <strong className="text-gray-700">{exp.variants?.length || 0}</strong></span>
                                        <span>Created: {new Date(exp.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleAnalyze(exp.id)}
                                        disabled={isAnalyzing && selectedId === exp.id}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100"
                                    >
                                        {isAnalyzing && selectedId === exp.id ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <BarChart3 size={14} />
                                        )}
                                        Analyze
                                    </button>
                                    {exp.status === 'RUNNING' ? (
                                        <button
                                            onClick={() => handlePause(exp.id)}
                                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg"
                                            title="Pause"
                                        >
                                            <Pause size={16} />
                                        </button>
                                    ) : exp.status === 'PAUSED' ? (
                                        <button
                                            onClick={() => handleResume(exp.id)}
                                            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"
                                            title="Resume"
                                        >
                                            <Play size={16} />
                                        </button>
                                    ) : null}
                                    <ChevronRight className="text-gray-400" size={18} />
                                </div>
                            </div>

                            {/* Analysis Results */}
                            {analysis && selectedId === exp.id && (
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <div className={`p-3 rounded-lg ${analysis.hasWinner ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
                                        {analysis.hasWinner ? (
                                            <div className="flex items-center gap-2 text-green-700">
                                                <CheckCircle2 size={18} />
                                                <span className="font-medium">Winner Found!</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 text-gray-600">
                                                <AlertCircle size={18} />
                                                <span>No significant winner yet</span>
                                            </div>
                                        )}
                                        <p className="text-sm mt-2 text-gray-600">{analysis.recommendation}</p>
                                    </div>

                                    {/* Variant Results */}
                                    <div className="mt-4 grid gap-2">
                                        {analysis.variants.map(v => (
                                            <div
                                                key={v.id}
                                                className={`flex items-center justify-between p-3 rounded-lg ${v.isSignificant ? 'bg-green-50' : 'bg-gray-50'
                                                    }`}
                                            >
                                                <span className="font-medium text-gray-900">Variant {v.label}</span>
                                                <div className="flex items-center gap-4 text-sm">
                                                    <span>Value: <strong>{v.metricValue.toFixed(2)}%</strong></span>
                                                    <span>p-value: <strong>{v.pValue?.toFixed(4) || '—'}</strong></span>
                                                    {v.isSignificant && (
                                                        <span className="text-green-600 font-medium flex items-center gap-1">
                                                            <CheckCircle2 size={14} />
                                                            Significant
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Create Modal Placeholder */}
            {showCreate && (
                <CreateExperimentModal
                    onClose={() => setShowCreate(false)}
                    onCreated={() => {
                        setShowCreate(false);
                        fetchExperiments();
                    }}
                />
            )}
        </div>
    );
}

// =============================================================================
// Create Experiment Modal
// =============================================================================

interface CreateModalProps {
    onClose: () => void;
    onCreated: () => void;
}

function CreateExperimentModal({ onClose, onCreated }: CreateModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [name, setName] = useState('');
    const [platform, setPlatform] = useState<'google' | 'meta'>('google');
    const [primaryMetric, setPrimaryMetric] = useState<'ctr' | 'conversions' | 'roas'>('ctr');
    const [adAccountId, setAdAccountId] = useState('');
    const [adAccounts, setAdAccounts] = useState<{ id: string; name: string; platform: string }[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        fetchAdAccounts();
    }, []);

    const fetchAdAccounts = async () => {
        if (!currentAccount) return;
        try {
            const res = await fetch('/api/ads', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            const data = await res.json();
            const active = data.filter((a: any) => a.externalId !== 'PENDING_SETUP');
            setAdAccounts(active);
            if (active.length > 0) setAdAccountId(active[0].id);
        } catch (err) {
            Logger.error('Failed to fetch ad accounts', { error: err });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !adAccountId) return;

        setIsSubmitting(true);
        try {
            const res = await fetch('/api/ads/experiments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount?.id || '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name.trim(),
                    platform,
                    adAccountId,
                    primaryMetric
                })
            });

            if (res.ok) {
                onCreated();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to create experiment');
            }
        } catch (err) {
            alert('Error creating experiment');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FlaskConical className="text-indigo-600" />
                    Create A/B Experiment
                </h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Experiment Name
                        </label>
                        <input
                            type="text"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g. Holiday Headlines Test"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Ad Account
                        </label>
                        <select
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            value={adAccountId}
                            onChange={e => {
                                setAdAccountId(e.target.value);
                                const acc = adAccounts.find(a => a.id === e.target.value);
                                if (acc) setPlatform(acc.platform.toLowerCase() as 'google' | 'meta');
                            }}
                            required
                        >
                            {adAccounts.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                    {acc.name} ({acc.platform})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Primary Metric
                        </label>
                        <select
                            className="w-full p-3 border border-gray-300 rounded-lg"
                            value={primaryMetric}
                            onChange={e => setPrimaryMetric(e.target.value as any)}
                        >
                            <option value="ctr">Click-Through Rate (CTR)</option>
                            <option value="conversions">Conversion Rate</option>
                            <option value="roas">Return on Ad Spend (ROAS)</option>
                        </select>
                    </div>

                    <div className="flex gap-3 justify-end pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !name.trim() || !adAccountId}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                            Create Experiment
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
