/**
 * useAIDraft - Manages AI-generated draft responses
 * 
 * Handles API calls to generate AI drafts for conversations.
 * Extracted from ChatWindow.tsx for improved modularity.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';

interface UseAIDraftOptions {
    conversationId: string;
    currentInput: string;
    onDraftGenerated: (draft: string) => void;
}

interface UseAIDraftResult {
    isGeneratingDraft: boolean;
    handleGenerateAIDraft: () => Promise<void>;
}

/**
 * Generates AI drafted responses for a conversation.
 */
export function useAIDraft({ conversationId, currentInput, onDraftGenerated }: UseAIDraftOptions): UseAIDraftResult {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
    const activeRequestRef = useRef<AbortController | null>(null);
    const identityRef = useRef({ conversationId, accountId: currentAccount?.id });
    identityRef.current = { conversationId, accountId: currentAccount?.id };

    useEffect(() => {
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
        setIsGeneratingDraft(false);
        return () => {
            activeRequestRef.current?.abort();
            activeRequestRef.current = null;
        };
    }, [conversationId, currentAccount?.id]);

    const handleGenerateAIDraft = useCallback(async () => {
        if (!token || !currentAccount || isGeneratingDraft) return;
        const requestConversationId = conversationId;
        const requestAccountId = currentAccount.id;
        const controller = new AbortController();
        activeRequestRef.current?.abort();
        activeRequestRef.current = controller;

        setIsGeneratingDraft(true);
        try {
            const res = await fetch(`/api/chat/${requestConversationId}/ai-draft`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': requestAccountId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ currentDraft: currentInput || '' }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const errData = await res.json();
                Logger.warn('AI draft generation returned error', { error: errData.error });
                return;
            }

            const data = await res.json();
            if (!controller.signal.aborted && identityRef.current.conversationId === requestConversationId && identityRef.current.accountId === requestAccountId && data.draft) {
                onDraftGenerated(data.draft);
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            Logger.error('AI draft generation failed:', { error: error });
        } finally {
            if (activeRequestRef.current === controller) {
                activeRequestRef.current = null;
                setIsGeneratingDraft(false);
            }
        }
    }, [token, currentAccount, conversationId, currentInput, onDraftGenerated, isGeneratingDraft]);

    return {
        isGeneratingDraft,
        handleGenerateAIDraft
    };
}
