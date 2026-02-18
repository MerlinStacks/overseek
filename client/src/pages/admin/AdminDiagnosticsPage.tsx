import {
    Bell, Trash2, RefreshCw, Send, AlertTriangle, CheckCircle, XCircle,
    ChevronDown, ChevronRight, Activity, Database, Zap, Webhook,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useDiagnostics } from './useDiagnostics';

/**
 * AdminDiagnosticsPage — presentational shell.
 *
 * All state management and data-fetching live in the `useDiagnostics` hook.
 * This component only renders UI.
 */
export function AdminDiagnosticsPage() {
    const {
        loading,
        subscriptions,
        accounts,
        selectedAccountId,
        setSelectedAccountId,
        testType,
        setTestType,
        testResult,
        message,
        expandedAccounts,
        systemHealth,
        healthLoading,
        fetchSystemHealth,
        fetchSubscriptions,
        fetchAccounts,
        sendTestPush,
        deleteSubscription,
        deleteAllSubscriptions,
        toggleAccount,
    } = useDiagnostics();

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">System Diagnostics</h1>
            </div>

            {/* Message Banner */}
            {message && (
                <div className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg",
                    message.type === 'success' ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                )}>
                    {message.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
                    <span className="text-sm">{message.text}</span>
                </div>
            )}

            {/* System Health Section */}
            <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <Activity size={20} />
                        System Health
                    </h2>
                    <button
                        onClick={fetchSystemHealth}
                        disabled={healthLoading}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={healthLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>

                {healthLoading && !systemHealth ? (
                    <div className="text-center py-8 text-slate-400">Loading system health...</div>
                ) : systemHealth ? (
                    <div className="space-y-6">
                        {/* Overall Status + Version */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "w-3 h-3 rounded-full",
                                    systemHealth.status === 'healthy' ? "bg-green-500" :
                                        systemHealth.status === 'degraded' ? "bg-amber-500" : "bg-red-500"
                                )} />
                                <span className="text-lg font-medium capitalize">{systemHealth.status}</span>
                            </div>
                            <div className="text-sm text-slate-500">
                                v{systemHealth.version.app} • Node {systemHealth.version.node} • Up {systemHealth.version.uptimeFormatted}
                            </div>
                        </div>

                        {/* Services Grid */}
                        <div className="grid grid-cols-3 gap-4">
                            {Object.entries(systemHealth.services).map(([name, service]) => (
                                <div key={name} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                                    <div className={cn(
                                        "w-2 h-2 rounded-full",
                                        service.status === 'healthy' ? "bg-green-500" :
                                            service.status === 'degraded' ? "bg-amber-500" : "bg-red-500"
                                    )} />
                                    <div>
                                        <div className="font-medium text-sm capitalize">{name}</div>
                                        {service.latencyMs !== undefined && (
                                            <div className="text-xs text-slate-500">{service.latencyMs}ms</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Queue Stats */}
                        <div>
                            <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                <Zap size={14} /> Job Queues
                            </h3>
                            <div className="grid grid-cols-4 gap-3">
                                {Object.entries(systemHealth.queues).map(([name, stats]) => (
                                    <div key={name} className="p-3 bg-slate-50 rounded-lg">
                                        <div className="text-xs font-medium text-slate-600 capitalize mb-1">{name}</div>
                                        <div className="flex gap-2 text-xs">
                                            <span className="text-amber-600">⏳{stats.waiting}</span>
                                            <span className="text-blue-600">▶{stats.active}</span>
                                            <span className="text-red-600">✗{stats.failed}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Sync Summary + Webhook Health */}
                        <div className="flex gap-6">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                    <Database size={14} /> Sync Status
                                </h3>
                                <div className="flex gap-3">
                                    {systemHealth.sync.entityTypes.map(entity => (
                                        <div key={entity.type} className="text-center p-2 bg-slate-50 rounded-lg">
                                            <div className="text-lg font-bold text-slate-700">{entity.accountsSynced}/{entity.accountsTracked}</div>
                                            <div className="text-xs text-slate-500 capitalize">{entity.type}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                    <Webhook size={14} /> Webhooks (24h)
                                </h3>
                                <div className="flex gap-3 text-center">
                                    <div className="p-2 bg-slate-50 rounded-lg">
                                        <div className="text-lg font-bold text-green-600">{systemHealth.webhooks.processed24h}</div>
                                        <div className="text-xs text-slate-500">Processed</div>
                                    </div>
                                    <div className="p-2 bg-slate-50 rounded-lg">
                                        <div className="text-lg font-bold text-red-600">{systemHealth.webhooks.failed24h}</div>
                                        <div className="text-xs text-slate-500">Failed</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-8 text-slate-400">Click refresh to load system health</div>
                )}
            </div>

            {/* Push Subscriptions Section */}
            <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                        <Bell size={20} />
                        Push Subscriptions
                    </h2>
                    <div className="flex gap-2">
                        <button
                            onClick={fetchSubscriptions}
                            disabled={loading}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                            Load Subscriptions
                        </button>
                        {subscriptions && subscriptions.totalSubscriptions > 0 && (
                            <button
                                onClick={deleteAllSubscriptions}
                                disabled={loading}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                                <Trash2 size={16} />
                                Delete All
                            </button>
                        )}
                    </div>
                </div>

                {subscriptions && (
                    <div className="space-y-4">
                        <div className="flex gap-4 text-sm text-slate-600">
                            <span>Total: <strong>{subscriptions.totalSubscriptions}</strong></span>
                            <span>Accounts: <strong>{subscriptions.uniqueAccounts}</strong></span>
                        </div>

                        {Object.entries(subscriptions.byAccount).map(([accountKey, subs]) => (
                            <div key={accountKey} className="border border-slate-200 rounded-lg overflow-hidden">
                                <button
                                    onClick={() => toggleAccount(accountKey)}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                                >
                                    <span className="font-medium text-slate-700">{accountKey}</span>
                                    <span className="flex items-center gap-2 text-sm text-slate-500">
                                        {subs.length} subscription{subs.length !== 1 ? 's' : ''}
                                        {expandedAccounts.has(accountKey) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </span>
                                </button>
                                {expandedAccounts.has(accountKey) && (
                                    <div className="divide-y divide-slate-100">
                                        {subs.map(sub => (
                                            <div key={sub.id} className="px-4 py-3 flex items-center justify-between text-sm">
                                                <div className="space-y-1">
                                                    <div className="font-medium text-slate-700">{sub.userEmail}</div>
                                                    <div className="text-xs text-slate-500">
                                                        ID: {sub.id} | User: {sub.userId}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <span className={cn("px-2 py-0.5 rounded text-xs", sub.notifyOrders ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                                                            Orders: {sub.notifyOrders ? 'ON' : 'OFF'}
                                                        </span>
                                                        <span className={cn("px-2 py-0.5 rounded text-xs", sub.notifyMessages ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                                                            Messages: {sub.notifyMessages ? 'ON' : 'OFF'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => deleteSubscription(sub.id)}
                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Delete subscription"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Test Push Section */}
            <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
                    <Send size={20} />
                    Test Push Notification
                </h2>

                <div className="flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Select Account</label>
                        <select
                            value={selectedAccountId}
                            onChange={(e) => setSelectedAccountId(e.target.value)}
                            onFocus={() => accounts.length === 0 && fetchAccounts()}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">-- Select Account --</option>
                            {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="w-48">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Notification Type</label>
                        <select
                            value={testType}
                            onChange={(e) => setTestType(e.target.value as 'order' | 'message')}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="order">New Order</option>
                            <option value="message">New Message</option>
                        </select>
                    </div>
                    <button
                        onClick={sendTestPush}
                        disabled={!selectedAccountId || loading}
                        className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Send size={16} />
                        Send Test
                    </button>
                </div>

                {testResult && (
                    <div className="mt-4 p-4 bg-slate-50 rounded-lg text-sm">
                        <div className="font-medium text-slate-700 mb-2">Test Result for {testResult.accountName}</div>
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <div className="text-2xl font-bold text-green-600">{testResult.sent}</div>
                                <div className="text-xs text-slate-500">Sent</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-red-600">{testResult.failed}</div>
                                <div className="text-xs text-slate-500">Failed</div>
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-slate-600">{testResult.eligibleSubscriptions}</div>
                                <div className="text-xs text-slate-500">Eligible</div>
                            </div>
                        </div>
                        {testResult.subscriptionIds.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                                <div className="text-xs text-slate-500 mb-1">Targeted Subscriptions:</div>
                                {testResult.subscriptionIds.map(s => (
                                    <div key={s.id} className="text-xs text-slate-600">
                                        ID: {s.id} | User: {s.userId}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Info Box */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                <div className="text-sm text-amber-800">
                    <p className="font-medium mb-1">Debugging Notification Issues</p>
                    <p>If notifications are going to wrong accounts, check that each subscription's <strong>accountId</strong> matches the intended account. Subscriptions are tied to the account that was active when the user enabled push notifications.</p>
                </div>
            </div>
        </div>
    );
}
