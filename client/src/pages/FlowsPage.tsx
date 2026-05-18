/**
 * FlowsPage - Dedicated page for automation flows (formerly "Automations" tab).
 * Part of the Growth menu in the sidebar.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react';
import type { Edge, Node } from '@xyflow/react';
import { useSearchParams } from 'react-router-dom';
import { AutomationsList } from '../components/marketing/AutomationsList';
import { FlowBuilder } from '../components/marketing/FlowBuilder';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { Modal } from '../components/ui/Modal';
import { Toast, ToastType } from '../components/ui/Toast';
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

interface FlowDraftPayload {
    flowDefinition: FlowDefinition;
    savedAt: string;
}

type SaveIndicatorState = 'saved' | 'saving' | 'unsaved';

function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

const ALLOWED_DELAY_UNITS = new Set(['minutes', 'hours', 'days', 'weeks', 'months']);
const OPERATORS_WITHOUT_VALUE = new Set(['is_set', 'not_set']);

function hasConditionValue(rule: { operator?: unknown; value?: unknown }): boolean {
    if (OPERATORS_WITHOUT_VALUE.has(String(rule.operator || ''))) return true;
    return String(rule.value ?? '').trim() !== '';
}

function getDelayNodeError(config: Record<string, unknown>): string | null {
    const delayMode = String(config.delayMode || 'SPECIFIC_PERIOD').toUpperCase();
    if (delayMode !== 'SPECIFIC_PERIOD') {
        return 'uses a delay mode that is not supported yet';
    }

    const rawDuration = config.duration;
    const duration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration);
    const unit = String(config.unit || 'hours').toLowerCase();

    if (!Number.isFinite(duration) || duration <= 0) {
        return 'must have a duration greater than 0';
    }

    if (!ALLOWED_DELAY_UNITS.has(unit)) {
        return 'has an invalid time unit';
    }

    return null;
}

function validateFlowDefinition(flow: FlowDefinition): string | null {
    const nodes = flow.nodes || [];
    const edges = flow.edges || [];

    if (nodes.length === 0) return 'Add at least one node to the flow.';

    const triggerNodes = nodes.filter((node) => String(node.type).toLowerCase() === 'trigger');
    if (triggerNodes.length === 0) return 'Flow must include a trigger node.';
    if (triggerNodes.length > 1) return 'Flow can only have one trigger node.';

    const nodeIds = new Set(nodes.map((node) => node.id));
    const incoming = new Map<string, number>();
    for (const node of nodes) incoming.set(node.id, 0);
    for (const edge of edges) {
        if (nodeIds.has(edge.target)) {
            incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
        }
    }

    for (const node of nodes) {
        if (node.id !== triggerNodes[0].id && (incoming.get(node.id) || 0) === 0) {
            return `Node "${(node.data as { label?: string } | undefined)?.label || node.id}" is disconnected.`;
        }

        const config = (node.data as { config?: Record<string, unknown> } | undefined)?.config || {};
        if (node.type === 'delay') {
            const delayError = getDelayNodeError(config);
            if (delayError) {
                return `Delay node "${(node.data as { label?: string } | undefined)?.label || node.id}" ${delayError}.`;
            }
        }
        if (node.type === 'action' && typeof config.actionType !== 'string') {
            return `Action node "${(node.data as { label?: string } | undefined)?.label || node.id}" is missing action type.`;
        }
        if (node.type === 'condition') {
            const conditions = Array.isArray(config.conditions)
                ? config.conditions.filter((rule) => (
                    rule
                    && typeof rule === 'object'
                    && (rule as { field?: unknown }).field
                    && (rule as { operator?: unknown }).operator
                    && hasConditionValue(rule as { operator?: unknown; value?: unknown })
                ))
                : [];
            const hasLegacyCondition = Boolean(
                config.field
                && config.operator
                && hasConditionValue(config as { operator?: unknown; value?: unknown })
            );
            if (conditions.length === 0 && !hasLegacyCondition) {
                return `Condition node "${(node.data as { label?: string } | undefined)?.label || node.id}" is incomplete.`;
            }
            const trueBranch = edges.some((edge) => edge.source === node.id && edge.sourceHandle === 'true');
            const falseBranch = edges.some((edge) => edge.source === node.id && edge.sourceHandle === 'false');
            if (!trueBranch || !falseBranch) {
                return `Condition node "${(node.data as { label?: string } | undefined)?.label || node.id}" requires both YES and NO branches.`;
            }

            const outgoing = edges.filter((edge) => edge.source === node.id);
            if (outgoing.length > 2) {
                return `Condition node "${(node.data as { label?: string } | undefined)?.label || node.id}" can only have YES and NO branches.`;
            }

            const duplicateTrue = outgoing.filter((edge) => edge.sourceHandle === 'true').length > 1;
            const duplicateFalse = outgoing.filter((edge) => edge.sourceHandle === 'false').length > 1;
            if (duplicateTrue || duplicateFalse) {
                return `Condition node "${(node.data as { label?: string } | undefined)?.label || node.id}" has duplicate branch connections.`;
            }
        }

        if (node.type !== 'condition') {
            const outgoing = edges.filter((edge) => edge.source === node.id).length;
            if (outgoing > 1) {
                return `Node "${(node.data as { label?: string } | undefined)?.label || node.id}" cannot branch to multiple paths.`;
            }
        }
    }

    return null;
}

function getInvalidNodeIds(flow: FlowDefinition): string[] {
    const nodes = flow.nodes || [];
    const edges = flow.edges || [];
    const invalid = new Set<string>();
    const nodeIds = new Set(nodes.map((node) => node.id));
    const triggerNodes = nodes.filter((node) => String(node.type).toLowerCase() === 'trigger');

    if (triggerNodes.length !== 1) {
        triggerNodes.forEach((node) => invalid.add(node.id));
    }

    const incoming = new Map<string, number>();
    for (const node of nodes) incoming.set(node.id, 0);
    for (const edge of edges) {
        if (nodeIds.has(edge.target)) {
            incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
        }
    }

    for (const node of nodes) {
        const config = (node.data as { config?: Record<string, unknown> } | undefined)?.config || {};
        if (triggerNodes[0] && node.id !== triggerNodes[0].id && (incoming.get(node.id) || 0) === 0) invalid.add(node.id);
        if (node.type === 'delay' && getDelayNodeError(config)) invalid.add(node.id);
        if (node.type === 'action' && typeof config.actionType !== 'string') invalid.add(node.id);
        if (node.type === 'condition') {
            const conditions = Array.isArray(config.conditions)
                ? config.conditions.filter((rule) => (
                    rule
                    && typeof rule === 'object'
                    && (rule as { field?: unknown }).field
                    && (rule as { operator?: unknown }).operator
                    && hasConditionValue(rule as { operator?: unknown; value?: unknown })
                ))
                : [];
            const hasLegacyCondition = Boolean(
                config.field
                && config.operator
                && hasConditionValue(config as { operator?: unknown; value?: unknown })
            );
            if (conditions.length === 0 && !hasLegacyCondition) invalid.add(node.id);
            const trueBranch = edges.some((edge) => edge.source === node.id && edge.sourceHandle === 'true');
            const falseBranch = edges.some((edge) => edge.source === node.id && edge.sourceHandle === 'false');
            if (!trueBranch || !falseBranch) invalid.add(node.id);

            const outgoing = edges.filter((edge) => edge.source === node.id);
            const duplicateTrue = outgoing.filter((edge) => edge.sourceHandle === 'true').length > 1;
            const duplicateFalse = outgoing.filter((edge) => edge.sourceHandle === 'false').length > 1;
            if (outgoing.length > 2 || duplicateTrue || duplicateFalse) invalid.add(node.id);
        }

        if (node.type !== 'condition') {
            const outgoing = edges.filter((edge) => edge.source === node.id).length;
            if (outgoing > 1) invalid.add(node.id);
        }
    }

    return Array.from(invalid);
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
    nodePerformance?: Array<{
        nodeId: string;
        executions: number;
        failed: number;
        skipped: number;
        failureRate: number;
        avgExecutionMs: number | null;
        lastOutcome: string | null;
        lastSeenAt: string;
    }>;
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

type NodeAnalyticsStatus = 'completed' | 'skipped' | 'failed';

interface NodeAnalyticsResponse {
    nodeId: string;
    status: NodeAnalyticsStatus;
    counts: Record<NodeAnalyticsStatus, number>;
    pagination: {
        page: number;
        perPage: number;
        total: number;
        totalPages: number;
    };
    contacts: Array<{
        id: string;
        enrollmentId: string;
        name: string;
        email: string;
        outcome?: string | null;
        occurredAt: string;
        triggerEntityId?: string | null;
        journey: Array<{
            nodeId?: string | null;
            eventType: string;
            outcome?: string | null;
            createdAt: string;
        }>;
    }>;
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
    const [searchParams, setSearchParams] = useSearchParams();

    const [isEditing, setIsEditing] = useState(false);
    const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
    const [editingFlowData, setEditingFlowData] = useState<FlowRecord | null>(null);
    const [analytics, setAnalytics] = useState<AutomationAnalytics | null>(null);
    const [recentEnrollments, setRecentEnrollments] = useState<EnrollmentRow[]>([]);
    const [recentRunEvents, setRecentRunEvents] = useState<RunEventRow[]>([]);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [isSavingFlow, setIsSavingFlow] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [toastVisible, setToastVisible] = useState(false);
    const [toastType, setToastType] = useState<ToastType>('error');
    const [recoveryPrompt, setRecoveryPrompt] = useState<{ flowId: string; flowName: string; draftSavedAt?: string } | null>(null);
    const [saveState, setSaveState] = useState<SaveIndicatorState>('saved');
    const [isDirty, setIsDirty] = useState(false);
    const [pendingClose, setPendingClose] = useState(false);
    const [isClosingEditor, setIsClosingEditor] = useState(false);
    const [undoRedoState, setUndoRedoState] = useState({ canUndo: false, canRedo: false });
    const [invalidNodeIds, setInvalidNodeIds] = useState<string[]>([]);
    const [nodeAnalyticsNodeId, setNodeAnalyticsNodeId] = useState<string | null>(null);
    const [nodeAnalyticsStatus, setNodeAnalyticsStatus] = useState<NodeAnalyticsStatus>('completed');
    const [nodeAnalyticsPage, setNodeAnalyticsPage] = useState(1);
    const [nodeAnalytics, setNodeAnalytics] = useState<NodeAnalyticsResponse | null>(null);
    const [isNodeAnalyticsLoading, setIsNodeAnalyticsLoading] = useState(false);
    const [expandedJourneyEnrollmentId, setExpandedJourneyEnrollmentId] = useState<string | null>(null);

    const baselineFlowRef = useRef<string>('');
    const autosaveTimerRef = useRef<number | null>(null);
    const undoRedoHandlersRef = useRef<{ undo: () => void; redo: () => void } | null>(null);

    const showToast = (message: string, type: ToastType = 'error') => {
        setToastMessage(message);
        setToastType(type);
        setToastVisible(true);
    };

    const getNodeLabel = useCallback((nodeId: string | null) => {
        if (!nodeId) return 'Node';
        const node = editingFlowData?.flowDefinition?.nodes?.find((candidate) => candidate.id === nodeId);
        const data = node?.data as { label?: string; config?: { subject?: string; actionType?: string } } | undefined;
        return data?.label || data?.config?.subject || data?.config?.actionType || `Node ${nodeId}`;
    }, [editingFlowData?.flowDefinition?.nodes]);

    const openNodeAnalytics = useCallback((nodeId: string) => {
        setNodeAnalyticsNodeId(nodeId);
        setNodeAnalyticsStatus('completed');
        setNodeAnalyticsPage(1);
        setExpandedJourneyEnrollmentId(null);
    }, []);

    const getDraftKey = useCallback((flowId: string) => {
        if (!currentAccount?.id) return null;
        return `overseek-flow-draft:${currentAccount.id}:${flowId}`;
    }, [currentAccount?.id]);

    const serializeFlow = (flow: FlowDefinition | null | undefined) => {
        if (!flow) return JSON.stringify({ nodes: [], edges: [] });
        return JSON.stringify({ nodes: flow.nodes || [], edges: flow.edges || [] });
    };

    const handleEditFlow = useCallback(async (id: string, requestedName?: string) => {
        if (searchParams.get('flowId') !== id) {
            setSearchParams({ flowId: id }, { replace: true });
        }

        setEditingItem({ id, name: requestedName || 'Loading flow...' });

        try {
            const res = await fetch(`/api/marketing/automations/${id}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || ''
                }
            });

            if (!res.ok) {
                showToast('Failed to load flow details');
                return;
            }

            const data: FlowRecord = await res.json();
            const resolvedName = requestedName || data.name || 'Untitled flow';

            const draftKey = getDraftKey(id);
            if (draftKey) {
                try {
                    const rawDraft = window.localStorage.getItem(draftKey);
                    if (rawDraft) {
                        const parsedDraft = JSON.parse(rawDraft) as FlowDraftPayload;
                        if (parsedDraft?.flowDefinition?.nodes && Array.isArray(parsedDraft.flowDefinition.nodes)) {
                            const serverFlow = serializeFlow(data.flowDefinition as FlowDefinition | undefined);
                            const draftFlow = serializeFlow(parsedDraft.flowDefinition);

                            if (serverFlow !== draftFlow) {
                                setRecoveryPrompt({
                                    flowId: id,
                                    flowName: resolvedName,
                                    draftSavedAt: parsedDraft.savedAt,
                                });
                            } else {
                                window.localStorage.removeItem(draftKey);
                            }
                        }
                    }
                } catch (error) {
                    Logger.warn('Failed to parse flow draft from localStorage', { error, flowId: id });
                }
            }

            setEditingFlowData(data);
            setEditingItem({ id, name: resolvedName });
            setIsEditing(true);
            baselineFlowRef.current = serializeFlow(data.flowDefinition as FlowDefinition | undefined);
            setIsDirty(false);
            setSaveState('saved');
            setInvalidNodeIds(getInvalidNodeIds((data.flowDefinition as FlowDefinition | undefined) || { nodes: [], edges: [] }));
        } catch (error) {
            Logger.error('An error occurred', { error });
            showToast('Failed to load flow details');
        }
    }, [searchParams, setSearchParams, token, currentAccount, getDraftKey]);

    const handleCloseEditor = useCallback(() => {
        setIsClosingEditor(true);
        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }
        setIsEditing(false);
        setEditingItem(null);
        setEditingFlowData(null);
        setAnalytics(null);
        setRecentEnrollments([]);
        setRecentRunEvents([]);
        setRecoveryPrompt(null);
        setInvalidNodeIds([]);
        setSearchParams({}, { replace: true });
    }, [setSearchParams]);

    useEffect(() => {
        const flowId = searchParams.get('flowId');
        if (isClosingEditor) {
            if (!flowId) setIsClosingEditor(false);
            return;
        }
        if (!flowId || isEditing || !token || !currentAccount) return;
        void handleEditFlow(flowId);
    }, [searchParams, isEditing, token, currentAccount, handleEditFlow, isClosingEditor]);

    const handleFlowChange = useCallback((flow: FlowDefinition) => {
        if (!editingItem || !editingFlowData) return;
        const draftKey = getDraftKey(editingItem.id);
        if (!draftKey) return;

        const current = serializeFlow(flow);
        const dirty = current !== baselineFlowRef.current;
        setIsDirty(dirty);
        setSaveState(dirty ? 'unsaved' : 'saved');
        const nextInvalidNodeIds = getInvalidNodeIds(flow);
        setInvalidNodeIds((previous) => (
            areStringArraysEqual(previous, nextInvalidNodeIds) ? previous : nextInvalidNodeIds
        ));

        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }

        if (!dirty) {
            try {
                window.localStorage.removeItem(draftKey);
            } catch (error) {
                Logger.warn('Failed to clear flow draft from localStorage', { error, flowId: editingItem.id });
            }
            return;
        }

        try {
            setSaveState('saving');
            autosaveTimerRef.current = window.setTimeout(() => {
                try {
                    const payload: FlowDraftPayload = {
                        flowDefinition: flow,
                        savedAt: new Date().toISOString()
                    };
                    window.localStorage.setItem(draftKey, JSON.stringify(payload));
                    setSaveState('unsaved');
                } catch (error) {
                    Logger.warn('Failed to persist flow draft to localStorage', { error, flowId: editingItem.id });
                }
            }, 700);
        } catch (error) {
            Logger.warn('Failed to persist flow draft to localStorage', { error, flowId: editingItem.id });
        }
    }, [editingItem, editingFlowData, getDraftKey]);

    const handleRequestCloseEditor = useCallback(() => {
        if (isDirty) {
            setPendingClose(true);
            return;
        }
        handleCloseEditor();
    }, [isDirty, handleCloseEditor]);

    useEffect(() => {
        if (!isEditing) return;

        const onPopState = () => {
            handleRequestCloseEditor();
        };

        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [isEditing, handleRequestCloseEditor]);

    useEffect(() => {
        if (!isEditing || !editingItem || !isDirty) return;

        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [isEditing, editingItem, isDirty]);

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

    useEffect(() => {
        const loadNodeAnalytics = async () => {
            if (!editingItem || !currentAccount || !token || !nodeAnalyticsNodeId) return;

            setIsNodeAnalyticsLoading(true);
            try {
                const params = new URLSearchParams({
                    status: nodeAnalyticsStatus,
                    page: String(nodeAnalyticsPage),
                    perPage: '10'
                });
                const res = await fetch(`/api/marketing/automations/${editingItem.id}/nodes/${nodeAnalyticsNodeId}/analytics?${params.toString()}`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });

                if (!res.ok) {
                    throw new Error('Failed to load node analytics');
                }

                setNodeAnalytics(await res.json());
            } catch (error) {
                Logger.error('Failed to load node analytics', { error });
                showToast('Failed to load node analytics.');
            } finally {
                setIsNodeAnalyticsLoading(false);
            }
        };

        loadNodeAnalytics();
    }, [currentAccount, editingItem, nodeAnalyticsNodeId, nodeAnalyticsPage, nodeAnalyticsStatus, token]);

    const handleSaveFlow = async (flow: FlowDefinition) => {
        if (!editingItem || !currentAccount || !token) {
            showToast('Missing account or session context. Refresh and try again.');
            return;
        }

        const normalizedFlow = JSON.parse(JSON.stringify(flow, (_key, value) => (
            typeof value === 'function' ? undefined : value
        ))) as FlowDefinition;

        const validationError = validateFlowDefinition(normalizedFlow);
        if (validationError) {
            showToast(validationError);
            return;
        }

        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }

        setIsSavingFlow(true);
        try {
            const triggerNode = normalizedFlow.nodes.find((node) => String(node.type).toLowerCase() === 'trigger');
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
                flowDefinition: normalizedFlow,
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

            const draftKey = getDraftKey(editingItem.id);
            if (draftKey) {
                if (autosaveTimerRef.current) {
                    window.clearTimeout(autosaveTimerRef.current);
                    autosaveTimerRef.current = null;
                }
                window.localStorage.removeItem(draftKey);
            }

            baselineFlowRef.current = serializeFlow((updated.flowDefinition as FlowDefinition | undefined) || normalizedFlow);
            setIsDirty(false);
            setSaveState('saved');

            showToast('Flow saved', 'success');
        } catch (error) {
            Logger.error('An error occurred', { error });
            showToast('Failed to save flow');
        } finally {
            setIsSavingFlow(false);
        }
    };

    const handleRestoreDraft = () => {
        if (!recoveryPrompt || !editingFlowData) return;
        const draftKey = getDraftKey(recoveryPrompt.flowId);
        if (!draftKey) return;

        try {
            const rawDraft = window.localStorage.getItem(draftKey);
            if (!rawDraft) {
                showToast('No unsaved draft found');
                setRecoveryPrompt(null);
                return;
            }

            const parsedDraft = JSON.parse(rawDraft) as FlowDraftPayload;
            if (!parsedDraft?.flowDefinition?.nodes || !Array.isArray(parsedDraft.flowDefinition.nodes)) {
                showToast('Draft data is invalid');
                setRecoveryPrompt(null);
                return;
            }

            setEditingFlowData((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    flowDefinition: parsedDraft.flowDefinition,
                };
            });
            setIsDirty(true);
            setSaveState('unsaved');
            setInvalidNodeIds(getInvalidNodeIds(parsedDraft.flowDefinition));
            showToast('Unsaved draft restored', 'success');
        } catch (error) {
            Logger.warn('Failed to restore flow draft from localStorage', { error, flowId: recoveryPrompt.flowId });
            showToast('Failed to restore draft');
        } finally {
            setRecoveryPrompt(null);
        }
    };

    const handleDiscardDraft = () => {
        if (!recoveryPrompt) return;
        const draftKey = getDraftKey(recoveryPrompt.flowId);
        if (draftKey) {
            window.localStorage.removeItem(draftKey);
        }
        setRecoveryPrompt(null);
        showToast('Unsaved draft discarded', 'info');
    };

    const discardUnsavedAndClose = () => {
        setPendingClose(false);
        setIsDirty(false);
        setSaveState('saved');
        handleCloseEditor();
    };

    const handleToggleFlowStatus = async () => {
        if (!editingItem || !currentAccount || !editingFlowData || typeof editingFlowData.isActive !== 'boolean') return;

        const nextIsActive = !editingFlowData.isActive;
        setIsUpdatingStatus(true);

        try {
            const res = await fetch(`/api/marketing/automations/${editingItem.id}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({ isActive: nextIsActive })
            });

            if (!res.ok) {
                throw new Error('Failed to update flow status');
            }

            setEditingFlowData((prev) => prev ? { ...prev, isActive: nextIsActive } : prev);
            setToastMessage(`Flow ${nextIsActive ? 'enabled' : 'disabled'}`);
            setToastType('success');
            setToastVisible(true);
        } catch (error) {
            Logger.error('Failed to update flow status', { error });
            setToastMessage('Failed to update flow status');
            setToastType('error');
            setToastVisible(true);
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    if (isEditing) {
        return (
            <div className="relative z-50 h-[calc(100vh-64px)] bg-white -mx-4 -my-4 md:-mx-6 md:-my-6 lg:-mx-8 lg:-my-8">
                <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b bg-gray-50 p-4">
                        <div className="flex items-center gap-2">
                            <button onClick={handleRequestCloseEditor} className="rounded-full p-2 hover:bg-gray-200">
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
                                <div className="mt-1 flex items-center gap-2 text-xs">
                                    <span className={`rounded-full px-2 py-0.5 font-medium ${saveState === 'saving'
                                        ? 'bg-amber-100 text-amber-800'
                                        : isDirty
                                            ? 'bg-blue-100 text-blue-800'
                                            : 'bg-green-100 text-green-800'}`}>
                                        {saveState === 'saving' ? 'Saving draft...' : isDirty ? 'Unsaved changes' : 'All changes saved'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => undoRedoHandlersRef.current?.undo()}
                                disabled={!undoRedoState.canUndo}
                                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Undo (Ctrl/Cmd+Z)"
                            >
                                <Undo2 size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => undoRedoHandlersRef.current?.redo()}
                                disabled={!undoRedoState.canRedo}
                                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Redo (Ctrl/Cmd+Shift+Z)"
                            >
                                <Redo2 size={16} />
                            </button>
                            <button
                                onClick={handleToggleFlowStatus}
                                disabled={isUpdatingStatus || typeof editingFlowData?.isActive !== 'boolean'}
                                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${editingFlowData?.isActive
                                    ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} ${isUpdatingStatus ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                                {isUpdatingStatus
                                    ? 'Updating...'
                                    : (editingFlowData?.isActive ? 'Enabled' : 'Disabled')}
                            </button>
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

                    {analytics?.nodePerformance && analytics.nodePerformance.length > 0 && (
                        <div className="border-b bg-white px-4 py-3">
                            <div className="mb-2 text-xs uppercase text-gray-500">Node Reliability</div>
                            <div className="grid gap-2 md:grid-cols-2">
                                {analytics.nodePerformance.map((nodeStats) => (
                                    <div key={nodeStats.nodeId} className="rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-gray-900">Node {nodeStats.nodeId}</span>
                                            <span className="text-xs text-gray-500">{nodeStats.executions} runs</span>
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">
                                            {nodeStats.failed} failed · {nodeStats.skipped} skipped · {(nodeStats.failureRate * 100).toFixed(1)}% failure
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">
                                            Avg latency: {nodeStats.avgExecutionMs !== null ? `${nodeStats.avgExecutionMs}ms` : 'N/A'}
                                            {nodeStats.lastOutcome ? ` · Last: ${nodeStats.lastOutcome}` : ''}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex-1 overflow-hidden">
                        <ErrorBoundary>
                            <FlowBuilder
                                initialFlow={editingFlowData?.flowDefinition}
                                onSave={handleSaveFlow}
                                onCancel={handleRequestCloseEditor}
                                isSaveDisabled={isUpdatingStatus || isSavingFlow}
                                isSaving={isSavingFlow}
                                onFlowChange={handleFlowChange}
                                onUndoRedoStateChange={setUndoRedoState}
                                onUndoRedoHandlersChange={(handlers) => {
                                    undoRedoHandlersRef.current = handlers;
                                }}
                                invalidNodeIds={invalidNodeIds}
                                flowId={editingItem?.id}
                                onViewNodeAnalytics={openNodeAnalytics}
                            />
                        </ErrorBoundary>
                    </div>
                </div>
                <Toast message={toastMessage} isVisible={toastVisible} onClose={() => setToastVisible(false)} type={toastType} />
                <Modal
                    isOpen={Boolean(nodeAnalyticsNodeId)}
                    onClose={() => {
                        setNodeAnalyticsNodeId(null);
                        setNodeAnalytics(null);
                    }}
                    title={`${getNodeLabel(nodeAnalyticsNodeId)} Analytics`}
                    maxWidth="max-w-4xl"
                >
                    <div className="space-y-5">
                        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40">
                            {(['completed', 'skipped', 'failed'] as NodeAnalyticsStatus[]).map((status) => {
                                const count = nodeAnalytics?.counts?.[status] ?? 0;
                                const isActive = nodeAnalyticsStatus === status;
                                return (
                                    <button
                                        key={status}
                                        type="button"
                                        onClick={() => {
                                            setNodeAnalyticsStatus(status);
                                            setNodeAnalyticsPage(1);
                                            setExpandedJourneyEnrollmentId(null);
                                        }}
                                        className={`flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium capitalize transition-colors ${isActive
                                            ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300'
                                            : 'text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-800/70'}`}
                                    >
                                        <span>{status}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>
                                            {count.toLocaleString()}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold">Name</th>
                                        <th className="px-4 py-3 font-semibold">Email</th>
                                        <th className="px-4 py-3 font-semibold">{nodeAnalyticsStatus === 'completed' ? 'Completed On' : nodeAnalyticsStatus === 'skipped' ? 'Skipped On' : 'Failed On'}</th>
                                        <th className="px-4 py-3 font-semibold">Outcome</th>
                                        <th className="px-4 py-3 font-semibold text-right">Journey</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-800">
                                    {isNodeAnalyticsLoading && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-10 text-center text-slate-500">Loading node analytics...</td>
                                        </tr>
                                    )}
                                    {!isNodeAnalyticsLoading && nodeAnalytics?.contacts.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-10 text-center text-slate-500">No contacts found for this node and status.</td>
                                        </tr>
                                    )}
                                    {!isNodeAnalyticsLoading && nodeAnalytics?.contacts.map((contact) => (
                                        <Fragment key={contact.id}>
                                            <tr className="text-slate-700 dark:text-slate-200">
                                                <td className="px-4 py-3 font-medium text-blue-700 dark:text-blue-300">{contact.name}</td>
                                                <td className="px-4 py-3 break-all">{contact.email}</td>
                                                <td className="px-4 py-3">{new Date(contact.occurredAt).toLocaleDateString()}</td>
                                                <td className="px-4 py-3 text-xs text-slate-500">{contact.outcome || 'Completed'}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedJourneyEnrollmentId((current) => current === contact.enrollmentId ? null : contact.enrollmentId)}
                                                        className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                                                    >
                                                        View Journey
                                                    </button>
                                                </td>
                                            </tr>
                                            {expandedJourneyEnrollmentId === contact.enrollmentId && (
                                                <tr key={`${contact.id}-journey`}>
                                                    <td colSpan={5} className="bg-slate-50 px-4 py-3 dark:bg-slate-900/50">
                                                        <div className="space-y-2">
                                                            {contact.journey.map((event, index) => (
                                                                <div key={`${contact.id}-journey-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                                                    <span className="font-medium text-slate-900 dark:text-slate-100">
                                                                        {event.eventType}{event.outcome ? ` · ${event.outcome}` : ''}
                                                                    </span>
                                                                    <span>{event.nodeId ? `Node ${event.nodeId} · ` : ''}{new Date(event.createdAt).toLocaleString()}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                            <div>
                                Page {nodeAnalytics?.pagination.page ?? nodeAnalyticsPage} of {nodeAnalytics?.pagination.totalPages ?? 1}
                                {nodeAnalytics && ` · Viewing ${nodeAnalytics.contacts.length} of ${nodeAnalytics.pagination.total.toLocaleString()} results`}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={nodeAnalyticsPage <= 1 || isNodeAnalyticsLoading}
                                    onClick={() => {
                                        setExpandedJourneyEnrollmentId(null);
                                        setNodeAnalyticsPage((page) => Math.max(1, page - 1));
                                    }}
                                    className="rounded-lg border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    disabled={!nodeAnalytics || nodeAnalyticsPage >= nodeAnalytics.pagination.totalPages || isNodeAnalyticsLoading}
                                    onClick={() => {
                                        setExpandedJourneyEnrollmentId(null);
                                        setNodeAnalyticsPage((page) => page + 1);
                                    }}
                                    className="rounded-lg border border-slate-200 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </Modal>
                <Modal
                    isOpen={Boolean(recoveryPrompt)}
                    onClose={() => setRecoveryPrompt(null)}
                    title="Restore unsaved changes"
                    maxWidth="max-w-md"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-slate-700 dark:text-slate-200">
                            We found unsaved changes for <span className="font-semibold">{recoveryPrompt?.flowName}</span>.
                            {recoveryPrompt?.draftSavedAt ? ` Last saved ${new Date(recoveryPrompt.draftSavedAt).toLocaleString()}.` : ''}
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={handleDiscardDraft}
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                            >
                                Discard Draft
                            </button>
                            <button
                                type="button"
                                onClick={handleRestoreDraft}
                                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Restore Draft
                            </button>
                        </div>
                    </div>
                </Modal>
                <Modal
                    isOpen={pendingClose}
                    onClose={() => setPendingClose(false)}
                    title="Discard unsaved changes?"
                    maxWidth="max-w-md"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-slate-700 dark:text-slate-200">
                            You have unsaved changes in this flow. Leave editor and discard them?
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPendingClose(false)}
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                            >
                                Keep Editing
                            </button>
                            <button
                                type="button"
                                onClick={discardUnsavedAndClose}
                                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                            >
                                Discard Changes
                            </button>
                        </div>
                    </div>
                </Modal>
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
            <Toast message={toastMessage} isVisible={toastVisible} onClose={() => setToastVisible(false)} type={toastType} />
        </div>
    );
}
