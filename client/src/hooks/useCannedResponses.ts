/**
 * Hook for managing canned responses in the inbox.
 * Handles fetching, filtering, and selection of pre-saved reply templates.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

interface CannedResponseLabel {
    id: string;
    name: string;
    color: string;
}

export interface CannedResponse {
    id: string;
    shortcut: string;
    content: string;
    labelId: string | null;
    label: CannedResponseLabel | null;
}


export interface CustomerContext {
    firstName?: string;
    lastName?: string;
    email?: string;
    // Extended context
    ordersCount?: number;
    totalSpent?: number;
    wooCustomerId?: number;
    // Agent context
    agentFirstName?: string;
    agentFullName?: string;
}

interface UseCannedResponsesReturn {
    /** All available canned responses */
    cannedResponses: CannedResponse[];
    cannedLoading: boolean;
    cannedError: boolean;
    /** Filtered responses based on current filter text */
    filteredCanned: CannedResponse[];
    /** Whether the canned dropdown is visible */
    showCanned: boolean;
    /** Current filter text (without leading /) */
    cannedFilter: string;
    /** Show/hide the canned responses manager modal */
    showCannedManager: boolean;
    /** Set dropdown visibility */
    setShowCanned: (show: boolean) => void;
    /** Set manager modal visibility */
    setShowCannedManager: (show: boolean) => void;
    /** Handle input change to detect / trigger */
    handleInputForCanned: (input: string) => void;
    /** Select a canned response and replace placeholders */
    selectCanned: (response: CannedResponse, context?: CustomerContext) => string;
    /** Refetch canned responses (after manager updates) */
    refetchCanned: () => Promise<void>;
}

/**
 * Replaces placeholders in content with actual customer values.
 * Supports customer, order, and agent placeholders.
 */
function replacePlaceholders(content: string, context?: CustomerContext): string {
    if (!context) return content;

    const fullName = [context.firstName, context.lastName].filter(Boolean).join(' ');
    const greeting = context.firstName ? `Hi ${context.firstName}` : 'Hi there';
    const formattedSpent = context.totalSpent != null
        ? `$${context.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '';

    return content
        // Customer placeholders
        .replace(/\{\{customer\.firstName\}\}/gi, context.firstName || 'there')
        .replace(/\{\{customer\.lastName\}\}/gi, context.lastName || '')
        .replace(/\{\{customer\.email\}\}/gi, context.email || '')
        .replace(/\{\{customer\.name\}\}/gi, fullName || 'there')
        .replace(/\{\{customer\.greeting\}\}/gi, greeting)
        .replace(/\{\{customer\.ordersCount\}\}/gi, context.ordersCount?.toString() || '0')
        .replace(/\{\{customer\.totalSpent\}\}/gi, formattedSpent)
        // Agent placeholders
        .replace(/\{\{agent\.firstName\}\}/gi, context.agentFirstName || '')
        .replace(/\{\{agent\.fullName\}\}/gi, context.agentFullName || '');
}


/**
 * Manages canned response state and logic.
 * Detects '/' prefix in input to show dropdown, filters by shortcut/content.
 */
export function useCannedResponses(): UseCannedResponsesReturn {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    const accountId = currentAccount?.id;
    const scope = JSON.stringify([accountId, user?.id, token]);
    const [result, setResult] = useState<{ scope: string; responses: CannedResponse[]; loading: boolean; error: boolean } | null>(null);
    const current = result?.scope === scope ? result : null;
    const cannedResponses = useMemo(() => current?.responses || [], [current]);
    const cannedLoading = Boolean(accountId && token && (!current || current.loading));
    const cannedError = current?.error ?? false;
    const controllerRef = useRef<AbortController | null>(null);
    const [showCanned, setShowCanned] = useState(false);
    const [cannedFilter, setCannedFilter] = useState('');
    const [showCannedManager, setShowCannedManager] = useState(false);

    // Fetch canned responses on mount
    const fetchCanned = useCallback(async () => {
        controllerRef.current?.abort();
        if (!accountId || !token) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        setResult({ scope, responses: [], loading: true, error: false });

        try {
            const res = await fetch('/api/chat/canned-responses', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
                },
                signal: controller.signal,
            });
            if (!res.ok) throw new Error('Saved replies request failed');
            const data = await res.json();
            if (!Array.isArray(data)) throw new Error('Invalid saved replies response');
            if (!controller.signal.aborted) setResult({ scope, responses: data, loading: false, error: false });
        } catch {
            if (!controller.signal.aborted) setResult({ scope, responses: [], loading: false, error: true });
        }
    }, [accountId, token, scope]);

    useEffect(() => {
        void fetchCanned();
        return () => controllerRef.current?.abort();
    }, [fetchCanned]);

    // Filter by shortcut, content, or label name
    const filteredCanned = useMemo(() => {
        if (!cannedFilter) return cannedResponses;
        const filter = cannedFilter.toLowerCase();
        return cannedResponses.filter(r =>
            r.shortcut.toLowerCase().includes(filter) ||
            r.content.toLowerCase().includes(filter) ||
            (r.label?.name && r.label.name.toLowerCase().includes(filter))
        );
    }, [cannedResponses, cannedFilter]);

    /**
     * Detects '/' prefix in input to trigger canned dropdown.
     * Call this from onChange handler with the current input value.
     */
    const handleInputForCanned = useCallback((input: string) => {
        // Strip HTML tags to get plain text
        const plainText = input.replace(/<[^>]*>/g, '').trim();
        if (plainText.startsWith('/')) {
            setShowCanned(true);
            setCannedFilter(plainText.slice(1).toLowerCase());
        } else {
            setShowCanned(false);
            setCannedFilter('');
        }
    }, []);

    /**
     * Selects a canned response and replaces placeholders.
     * Returns the content with placeholders replaced.
     */
    const selectCanned = useCallback((response: CannedResponse, context?: CustomerContext): string => {
        setShowCanned(false);
        setCannedFilter('');
        return replacePlaceholders(response.content, context);
    }, []);

    return {
        cannedResponses,
        cannedLoading,
        cannedError,
        filteredCanned,
        showCanned,
        cannedFilter,
        showCannedManager,
        setShowCanned,
        setShowCannedManager,
        handleInputForCanned,
        selectCanned,
        refetchCanned: fetchCanned
    };
}
