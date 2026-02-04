/**
 * AdAccountCard
 * 
 * Individual ad account display card with insights and actions.
 */
import { Facebook, Loader2, Trash2, RefreshCw, Pencil, AlertCircle } from 'lucide-react';
import { formatCurrency, formatCompact, formatNumber } from '../../utils/format';

interface AdAccount {
    id: string;
    platform: string;
    name: string;
    externalId: string;
}

interface AdInsights {
    spend: number;
    impressions: number;
    clicks: number;
    roas: number;
    currency: string;
}

interface AdAccountCardProps {
    account: AdAccount;
    insights?: AdInsights;
    isLoadingInsights: boolean;
    error?: string;
    onRefresh: () => void;
    onEdit: () => void;
    onDisconnect: () => void;
    onCompleteSetup: () => void;
    onReconnect: () => void;
}

/**
 * Google icon SVG component.
 */
function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
    );
}

export function AdAccountCard({
    account,
    insights,
    isLoadingInsights,
    error,
    onRefresh,
    onEdit,
    onDisconnect,
    onCompleteSetup,
    onReconnect
}: AdAccountCardProps) {
    const isPending = account.externalId === 'PENDING_SETUP';

    return (
        <div className={`bg-white rounded-xl shadow-xs border p-4 ${isPending ? 'border-amber-300' : error ? 'border-red-200' : 'border-gray-200'}`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${account.platform === 'META' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'}`}>
                        {account.platform === 'META' ? <Facebook size={20} /> : <GoogleIcon className="w-5 h-5" />}
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900">{account.name}</h3>
                        <p className="text-xs text-gray-500 font-mono">{isPending ? 'Setup not complete' : account.externalId}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isPending ? (
                        <button
                            onClick={onCompleteSetup}
                            className="bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded-full hover:bg-amber-200"
                        >Complete Setup</button>
                    ) : (
                        <>
                            {error && <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Error</span>}
                            {!error && <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Active</span>}
                            <button
                                onClick={onRefresh}
                                disabled={isLoadingInsights}
                                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-sm disabled:opacity-50"
                                title="Refresh data"
                            >
                                <RefreshCw size={16} className={isLoadingInsights ? 'animate-spin' : ''} />
                            </button>
                            <button onClick={onEdit} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-sm" title="Edit credentials">
                                <Pencil size={16} />
                            </button>
                        </>
                    )}
                    <button onClick={onDisconnect} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-sm" title="Disconnect">
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            {/* Insights Row */}
            {!isPending && insights && (
                <div className="mt-4 pt-4 border-t grid grid-cols-4 gap-4 text-sm">
                    <div>
                        <p className="text-xs text-gray-500 uppercase">Spend (30d)</p>
                        <p className="font-semibold">{formatCurrency(insights.spend, insights.currency || 'USD')}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase">ROAS</p>
                        <p className="font-semibold">{(insights.roas || 0).toFixed(2)}x</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase">Impressions</p>
                        <p className="font-medium text-gray-700">{formatCompact(insights.impressions)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500 uppercase">Clicks</p>
                        <p className="font-medium text-gray-700">{formatNumber(insights.clicks)}</p>
                    </div>
                </div>
            )}

            {/* Error Display */}
            {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                            <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
                            <div className="text-sm text-red-700">
                                <p className="font-medium">Failed to load data</p>
                                <p className="text-xs mt-1 text-red-600">{error}</p>
                            </div>
                        </div>
                        <button
                            onClick={onReconnect}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 shrink-0"
                        >
                            <RefreshCw size={14} />
                            Reconnect
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export type { AdAccount, AdInsights };
