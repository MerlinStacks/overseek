/**
 * AudienceSyncPanel - Audience Segment Syncing
 * 
 * Manages syncing customer segments to ad platforms.
 * Part of AI Co-Pilot v2 - Phase 2: Audience Intelligence.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Logger } from '../../utils/logger';
import {
    Users, Upload, RefreshCw, Loader2, CheckCircle2,
    AlertCircle, Clock, Facebook, Sparkles
} from 'lucide-react';

interface Segment {
    id: string;
    name: string;
    customerCount: number;
}

interface SyncedAudience {
    id: string;
    segmentName: string;
    platform: string;
    platformAudienceId: string;
    customerCount: number;
    lastSyncedAt: string;
    status: string;
}

export function AudienceSyncPanel() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [segments, setSegments] = useState<Segment[]>([]);
    const [syncedAudiences, setSyncedAudiences] = useState<SyncedAudience[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [syncingSegment, setSyncingSegment] = useState<string | null>(null);
    const [selectedPlatform, setSelectedPlatform] = useState<'meta' | 'google'>('meta');

    const headers = useCallback(() => ({
        'Authorization': `Bearer ${token}`,
        'X-Account-ID': currentAccount?.id || '',
        'Content-Type': 'application/json'
    }), [token, currentAccount?.id]);

    const fetchData = useCallback(async () => {
        if (!currentAccount) return;
        setIsLoading(true);
        try {
            // Fetch RFM segments
            const segRes = await fetch('/api/segments', { headers: headers() });
            const segData = await segRes.json();
            setSegments(segData.segments || []);

            // Fetch synced audiences
            const audRes = await fetch('/api/ads/audiences', { headers: headers() });
            const audData = await audRes.json();
            setSyncedAudiences(audData.audiences || []);
        } catch (err) {
            Logger.error('Failed to fetch audience data', { error: err });
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, headers]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSync = async (segmentId: string, segmentName: string) => {
        setSyncingSegment(segmentId);
        try {
            const res = await fetch('/api/ads/audiences/sync', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                    segmentId,
                    segmentName,
                    platform: selectedPlatform
                })
            });

            if (res.ok) {
                fetchData();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to sync audience');
            }
        } catch (err) {
            Logger.error('Failed to sync audience', { error: err });
            alert('Error syncing audience');
        } finally {
            setSyncingSegment(null);
        }
    };

    const handleCreateLookalike = async (audienceId: string) => {
        try {
            const res = await fetch('/api/ads/audiences/lookalike', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({ audienceId })
            });

            if (res.ok) {
                alert('Lookalike audience created successfully!');
                fetchData();
            } else {
                const err = await res.json();
                alert(err.error || 'Failed to create lookalike');
            }
        } catch (err) {
            Logger.error('Failed to create lookalike', { error: err });
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'SYNCED':
                return <CheckCircle2 size={16} className="text-green-500" />;
            case 'PENDING':
                return <Clock size={16} className="text-amber-500" />;
            case 'ERROR':
                return <AlertCircle size={16} className="text-red-500" />;
            default:
                return <Clock size={16} className="text-gray-400" />;
        }
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
                        <Users className="text-indigo-600" />
                        Audience Sync
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">Sync customer segments to ad platforms for targeting</p>
                </div>
                <button
                    onClick={() => fetchData()}
                    className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                    title="Refresh"
                >
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Platform Selection */}
            <div className="flex gap-2">
                <button
                    onClick={() => setSelectedPlatform('meta')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${selectedPlatform === 'meta'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    <Facebook size={16} />
                    Meta Ads
                </button>
                <button
                    onClick={() => setSelectedPlatform('google')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${selectedPlatform === 'google'
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    </svg>
                    Google Ads
                </button>
            </div>

            {/* Segments to Sync */}
            <div>
                <h3 className="font-semibold text-gray-900 mb-4">Available Segments</h3>

                {segments.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                        <Users className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                        <p className="text-gray-500 mb-2">No customer segments found</p>
                        <p className="text-sm text-gray-400">Create segments in the CRM section first</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {segments.map(seg => {
                            const isSynced = syncedAudiences.some(
                                a => a.segmentName === seg.name && a.platform === selectedPlatform
                            );
                            return (
                                <div
                                    key={seg.id}
                                    className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors"
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <h4 className="font-medium text-gray-900">{seg.name}</h4>
                                            <p className="text-sm text-gray-500">{seg.customerCount.toLocaleString()} customers</p>
                                        </div>
                                        {isSynced && (
                                            <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                                <CheckCircle2 size={12} />
                                                Synced
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleSync(seg.id, seg.name)}
                                        disabled={syncingSegment === seg.id}
                                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50 text-sm font-medium"
                                    >
                                        {syncingSegment === seg.id ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Upload size={14} />
                                        )}
                                        {isSynced ? 'Re-sync' : 'Sync to'} {selectedPlatform === 'meta' ? 'Meta' : 'Google'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Synced Audiences */}
            {syncedAudiences.length > 0 && (
                <div>
                    <h3 className="font-semibold text-gray-900 mb-4">Synced Audiences</h3>
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Segment</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Platform</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Customers</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Last Sync</th>
                                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {syncedAudiences.map(aud => (
                                    <tr key={aud.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-medium text-gray-900">{aud.segmentName}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${aud.platform === 'meta' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                                                }`}>
                                                {aud.platform === 'meta' ? <Facebook size={12} /> : null}
                                                {aud.platform.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600">
                                            {aud.customerCount.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="flex items-center gap-1 text-sm">
                                                {getStatusIcon(aud.status)}
                                                {aud.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">
                                            {new Date(aud.lastSyncedAt).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {aud.platform === 'meta' && (
                                                <button
                                                    onClick={() => handleCreateLookalike(aud.id)}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100"
                                                >
                                                    <Sparkles size={14} />
                                                    Lookalike
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
