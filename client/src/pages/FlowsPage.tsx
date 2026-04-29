/**
 * FlowsPage - Dedicated page for automation flows (formerly "Automations" tab).
 * Part of the Growth menu in the sidebar.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Edge, Node } from '@xyflow/react';
import { AutomationsList } from '../components/marketing/AutomationsList';
import { FlowBuilder } from '../components/marketing/FlowBuilder';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAccount } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { Logger } from '../utils/logger';

interface EditingItem {
    id: string;
    name: string;
}

interface FlowDefinition {
    nodes: Node[];
    edges: Edge[];
}

interface FlowRecord {
    id?: string;
    name?: string;
    triggerType?: string;
    triggerConfig?: Record<string, unknown>;
    isActive?: boolean;
    flowDefinition?: FlowDefinition | null;
    [key: string]: unknown;
}

interface AutomationAnalytics {
    enrollments: {
        active: number;
        completed: number;
        cancelled: number;
        total: number;
    };
    email: {
        sends: number;
        opens: number;
        clicks: number;
        unsubscribes: number;
    };
    goals: {
        conversions: number;
        revenue: number;
    };
    execution: {
        queued: number;
        waiting: number;
        sent: number;
        skipped: number;
        failed: number;
        notConfigured: number;
        cooldownBlocked: number;
        quietHoursBlocked: number;
        frequencyCapped: number;
        duplicateEnrollments: number;
        recoveredOrders: number;
    };
}

interface EnrollmentRow {
    id: string;
    email: string;
    status: string;
    statusReason?: string | null;
    enteredAt: string;
    convertedRevenue?: number | null;
}

interface RunEventRow {
    id: string;
    enrollmentId: string;
    nodeId?: string | null;
    eventType: string;
    outcome?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
}

function formatRunMetadataValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return null;
}

function getRunMetadataBadges(metadata?: Record<string, unknown> | null): Array<{ label: string; value: string }> {
    if (!metadata) return [];

    const candidates: Array<{ key: string; label: string }> = [
        { key: 'reason', label: 'Reason' },
        { key: 'orderId', label: 'Order' },
        { key: 'revenue', label: 'Revenue' },
        { key: 'recipientEmail', label: 'Recipient' },
        { key: 'sessionId', label: 'Session' },
        { key: 'recoverySessionId', label: 'Recovery Session' },
        { key: 'email', label: 'Email' },
        { key: 'frequencyCapHours', label: 'Flow Cap (hrs)' },
        { key: 'itemCount', label: 'Items' }
    ];

    return candidates
        .map(({ key, label }) => {
            const value = formatRunMetadataValue(metadata[key]);
            if (!value) return null;

            return {
                label,
                value: key === 'revenue' ? `$${value}` : value
            };
        })
        .filter((entry): entry is { label: string; value: string } => Boolean(entry));
}

function getExecutionSummaryBadges(analytics: AutomationAnalytics): Array<{ label: string; value: number }> {
    const { execution } = analytics;
    const entries: Array<{ label: string; value: number }> = [
        { label: 'Sent', value: execution.sent },
        { label: 'Skipped', value: execution.skipped },
        { label: 'Failed', value: execution.failed },
        { label: 'Waiting', value: execution.waiting },
        { label: 'Cooldown', value: execution.cooldownBlocked },
        { label: 'Quiet Hours', value: execution.quietHoursBlocked },
        { label: 'Frequency Cap', value: execution.frequencyCapped },
        { label: 'Duplicates', value: execution.duplicateEnrollments },
        { label: 'Recovered Orders', value: execution.recoveredOrders }
    ];

    return entries.filter((entry) => entry.value > 0);
}

export function FlowsPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [isEditing, setIsEditing] = useState(false);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
    const [editingFlowData, setEditingFlowData] = useState<FlowRecord | null>(null);
    const [analytics, setAnalytics] = useState<AutomationAnalytics | null>(null);
    const [recentEnrollments, setRecentEnrollments] = useState<EnrollmentRow[]>([]);
    const [recentRunEvents, setRecentRunEvents] = useState<RunEventRow[]>([]);

    const handleEditFlow = async (id: string, name: string) => {
        setEditingItem({ id, name });

        try {
            const res = await fetch(`/api/marketing/automations/${id}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });

            if (!res.ok) {
                alert('Failed to load flow details');
                return;
            }

            const data: FlowRecord = await res.json();
            setEditingFlowData(data);
            setIsEditing(true);
        } catch (error) {
            Logger.error('An error occurred', { error });
            alert('Failed to load flow details');
        }
    };

    const handleCloseEditor = () => {
        setIsEditing(false);
        setEditingItem(null);
        setEditingFlowData(null);
        setAnalytics(null);
        setRecentEnrollments([]);
        setRecentRunEvents([]);
    };

    useEffect(() => {
        const loadAutomationInsights = async () => {
            if (!isEditing || !editingItem || !token || !currentAccount) return;

            try {
                const [analyticsRes, enrollmentsRes, runEventsRes] = await Promise.all([
                    fetch(`/api/marketing/automations/${editingItem.id}/analytics`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'x-account-id': currentAccount.id
                        }
                    }),
                    fetch(`/api/marketing/automations/${editingItem.id}/enrollments?limit=5`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'x-account-id': currentAccount.id
                        }
                    }),
                    fetch(`/api/marketing/automations/${editingItem.id}/run-events?limit=8`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'x-account-id': currentAccount.id
                        }
                    })
                ]);

                if (analyticsRes.ok) {
                    setAnalytics(await analyticsRes.json());
                }

                if (enrollmentsRes.ok) {
                    setRecentEnrollments(await enrollmentsRes.json());
                }

                if (runEventsRes.ok) {
                    setRecentRunEvents(await runEventsRes.json());
                }
            } catch (error) {
                Logger.error('Failed to load automation analytics', { error });
            }
        };

        loadAutomationInsights();
    }, [currentAccount, editingItem, isEditing, token]);

    const handleSaveFlow = async (flow: FlowDefinition) => {
        if (!editingItem || !currentAccount) return;

        try {
            const triggerNode = flow.nodes.find((node) => String(node.type).toLowerCase() === 'trigger');
            const triggerConfig =
                (triggerNode?.data as Record<string, unknown> | undefined)?.config as Record<string, unknown> | undefined;
            const triggerType =
                typeof triggerConfig?.triggerType === 'string'
                    ? triggerConfig.triggerType
                    : (editingFlowData?.triggerType || 'NONE');

            const payload = {
                ...(editingFlowData || {}),
                id: editingItem.id,
                name: editingItem.name,
                flowDefinition: flow,
                triggerType,
                triggerConfig: triggerConfig || editingFlowData?.triggerConfig || {},
                isActive: editingFlowData?.isActive ?? true
            };

            const res = await fetch('/api/marketing/automations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => null);
                throw new Error(errorData?.error || 'Failed to save flow');
            }

            const updated: FlowRecord = await res.json();
            setEditingFlowData(updated);
            alert('Flow saved!');
        } catch (error) {
            Logger.error('An error occurred', { error });
            alert('Failed to save');
        }
    };

    if (isEditing) {
        return (
            <div className="absolute inset-0 top-16 z-50 -m-6 h-[calc(100vh-64px)] bg-white">
                <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b bg-gray-50 p-4">
                        <div className="flex items-center gap-2">
                            <button onClick={handleCloseEditor} className="rounded-full p-2 hover:bg-gray-200">
                                <ArrowLeft size={20} />
                            </button>
                            <div>
                                <h2 className="text-lg font-bold">{editingItem?.name}</h2>
                                {analytics && (
                                    <p className="text-sm text-gray-500">
                                        {analytics.enrollments.active} active, {analytics.goals.conversions} conversions, $
                                        {analytics.goals.revenue.toFixed(2)} revenue
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {analytics && (
                        <div className="grid grid-cols-2 gap-3 border-b bg-white px-4 py-3 md:grid-cols-4">
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs uppercase text-gray-500">Enrollments</div>
                                <div className="mt-1 text-lg font-semibold text-gray-900">{analytics.enrollments.total}</div>
                                <div className="text-xs text-gray-500">{analytics.enrollments.completed} completed</div>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs uppercase text-gray-500">Email</div>
                                <div className="mt-1 text-lg font-semibold text-gray-900">{analytics.email.sends}</div>
                                <div className="text-xs text-gray-500">
                                    {analytics.email.opens} opens, {analytics.email.clicks} clicks
                                </div>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs uppercase text-gray-500">Conversions</div>
                                <div className="mt-1 text-lg font-semibold text-gray-900">{analytics.goals.conversions}</div>
                                <div className="text-xs text-gray-500">{analytics.enrollments.cancelled} cancelled</div>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs uppercase text-gray-500">Revenue</div>
                                <div className="mt-1 text-lg font-semibold text-gray-900">
                                    ${analytics.goals.revenue.toFixed(2)}
                                </div>
                                <div className="text-xs text-gray-500">{analytics.email.unsubscribes} unsubscribes</div>
                            </div>
                        </div>
                    )}

                    {analytics && getExecutionSummaryBadges(analytics).length > 0 && (
                        <div className="border-b bg-white px-4 py-3">
                            <div className="mb-2 text-xs uppercase text-gray-500">Execution Summary</div>
                            <div className="flex flex-wrap gap-2">
                                {getExecutionSummaryBadges(analytics).map((badge) => (
                                    <span
                                        key={badge.label}
                                        className="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700"
                                    >
                                        {badge.label}: {badge.value}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {recentEnrollments.length > 0 && (
                        <div className="border-b bg-white px-4 py-3">
                            <div className="mb-2 text-xs uppercase text-gray-500">Recent Enrollments</div>
                            <div className="flex flex-wrap gap-2">
                                {recentEnrollments.map((enrollment) => (
                                    <div
                                        key={enrollment.id}
                                        className="rounded-full border border-gray-200 px-3 py-1.5 text-sm text-gray-700"
                                    >
                                        {enrollment.email} · {enrollment.status.toLowerCase()}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {recentRunEvents.length > 0 && (
                        <div className="border-b bg-white px-4 py-3">
                            <div className="mb-2 text-xs uppercase text-gray-500">Recent Run History</div>
                            <div className="grid gap-2 md:grid-cols-2">
                                {recentRunEvents.map((event) => {
                                    const badges = getRunMetadataBadges(event.metadata);

                                    return (
                                        <div key={event.id} className="rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-medium text-gray-900">{event.outcome || event.eventType}</span>
                                                <span className="text-xs text-gray-500">
                                                    {new Date(event.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="mt-1 text-xs text-gray-500">
                                                {event.eventType}
                                                {event.nodeId ? ` · node ${event.nodeId}` : ''}
                                            </div>
                                            {badges.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {badges.map((badge) => (
                                                        <span
                                                            key={`${event.id}-${badge.label}`}
                                                            className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
                                                        >
                                                            {badge.label}: {badge.value}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="flex-1 overflow-hidden">
                        <ErrorBoundary>
                            <FlowBuilder
                                initialFlow={editingFlowData?.flowDefinition}
                                onSave={handleSaveFlow}
                                onCancel={handleCloseEditor}
                            />
                        </ErrorBoundary>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Flows</h1>
                <p className="text-gray-500">Create and manage automated workflows for customer engagement.</p>
            </div>

            <ErrorBoundary>
                <AutomationsList onEdit={handleEditFlow} />
            </ErrorBoundary>
        </div>
    );
}
