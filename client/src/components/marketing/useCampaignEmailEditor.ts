import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';

interface CampaignEmail {
    id: string;
    name: string;
    subject?: string;
    content?: string;
    designJson?: unknown;
}

/** Do not expose an editable campaign until its complete saved content is loaded. */
export function useCampaignEmailEditor() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const requestRef = useRef<AbortController | null>(null);
    const [state, setState] = useState<{ accountId: string; item: CampaignEmail; loading: boolean; error: string | null } | null>(null);

    useEffect(() => {
        setState(null);
        return () => { requestRef.current?.abort(); };
    }, [accountId]);

    const close = useCallback(() => {
        requestRef.current?.abort();
        setState(null);
    }, []);

    const open = useCallback(async (id: string, name: string, subject?: string) => {
        if (!accountId) return;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setState({ accountId, item: { id, name, subject }, loading: true, error: null });
        try {
            const response = await fetch(`/api/marketing/campaigns/${id}`, {
                headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId }, signal: controller.signal,
            });
            if (!response.ok) throw new Error('Could not load the saved email. Nothing has been changed.');
            const campaign = await response.json() as CampaignEmail;
            if (controller.signal.aborted) return;
            setState({ accountId, item: { ...campaign, id, name: campaign.name ?? name, subject: campaign.subject ?? subject }, loading: false, error: null });
        } catch (error) {
            if (!controller.signal.aborted) setState({ accountId, item: { id, name, subject }, loading: false, error: error instanceof Error ? error.message : 'Could not load the saved email.' });
        }
    }, [accountId, token]);

    const save = useCallback(async (html: string, design: unknown, meta?: { subject: string }) => {
        if (!state || state.accountId !== accountId || state.loading || state.error) throw new Error('No loaded email to save');
        const response = await fetch(`/api/marketing/campaigns/${state.item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-id': state.accountId },
            body: JSON.stringify({ content: html, designJson: design, subject: meta?.subject ?? state.item.subject ?? '' }),
        });
        if (!response.ok) throw new Error('Failed to save email');
    }, [state, accountId, token]);

    const active = state?.accountId === accountId ? state : null;
    return { isOpen: Boolean(active), item: active?.item, loading: active?.loading, error: active?.error, open, close, save };
}
