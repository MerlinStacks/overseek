import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Search, Sparkles } from 'lucide-react';
import { ActionableRecommendation } from '../../types/ActionableTypes';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface AddKeywordModalProps {
    isOpen: boolean;
    onClose: () => void;
    recommendation: ActionableRecommendation;
    onConfirm: (data: { keyword: string; matchType: 'BROAD' | 'PHRASE' | 'EXACT'; bid: number; adGroupId: string }) => Promise<void>;
}

interface AdGroup {
    id: string;
    name: string;
    campaignId: string;
}

export function AddKeywordModal({ isOpen, onClose, recommendation, onConfirm }: AddKeywordModalProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [matches, setMatches] = useState<'BROAD' | 'PHRASE' | 'EXACT'>('PHRASE');
    const [keyword, setKeyword] = useState('');
    const [bid, setBid] = useState(0);
    const [adGroupId, setAdGroupId] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [adGroups, setAdGroups] = useState<AdGroup[]>([]);
    const [fetchingGroups, setFetchingGroups] = useState(false);

    // Initialize from recommendation
    useEffect(() => {
        if (isOpen && recommendation) {
            const action = recommendation.action as any;
            if (action.actionType === 'add_keyword') {
                setKeyword(action.keyword || '');
                setMatches(action.matchType || 'PHRASE');
                setBid(action.suggestedCpc || 1.00);

                if (action.campaignId && token && currentAccount) {
                    setFetchingGroups(true);
                    fetch(`/api/ads/campaigns/${action.campaignId}/adgroups`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'x-account-id': currentAccount.id
                        }
                    })
                        .then(res => {
                            if (!res.ok) throw new Error('Failed to fetch ad groups');
                            return res.json();
                        })
                        .then(data => {
                            setAdGroups(data);
                        })
                        .catch(err => {
                            console.error(err);
                            setAdGroups([]);
                        })
                        .finally(() => {
                            setFetchingGroups(false);
                        });
                }
            }
        }
    }, [isOpen, recommendation, token, currentAccount]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adGroupId) {
            alert('Please select an Ad Group');
            return;
        }

        setLoading(true);
        try {
            await onConfirm({
                keyword,
                matchType: matches,
                bid,
                adGroupId
            });
            onClose();
        } catch (error) {
            console.error('Failed to add keyword', error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-blue-50/50">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Sparkles size={18} className="text-blue-600" />
                        Add New Keyword
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Keyword</label>
                        <input
                            type="text"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Match Type</label>
                            <select
                                value={matches}
                                onChange={(e) => setMatches(e.target.value as any)}
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all bg-white"
                            >
                                <option value="BROAD">Broad</option>
                                <option value="PHRASE">Phrase</option>
                                <option value="EXACT">Exact</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max CPC ($)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={bid}
                                onChange={(e) => setBid(parseFloat(e.target.value))}
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Ad Group</label>
                        <select
                            value={adGroupId}
                            onChange={(e) => setAdGroupId(e.target.value)}
                            className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all bg-white"
                            required
                        >
                            <option value="" disabled>Select Ad Group...</option>
                            {adGroups.map(group => (
                                <option key={group.id} value={group.id}>{group.name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">Select the ad group to add this keyword to.</p>
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-70 flex items-center justify-center gap-2"
                        >
                            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={18} />}
                            Confirm Add
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
