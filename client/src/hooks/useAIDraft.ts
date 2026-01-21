/**
 * useAIDraft - Manages AI-generated draft responses
 * 
 * Handles API calls to generate AI drafts for conversations.
 * Extracted from ChatWindow.tsx for improved modularity.
 */

import { useState, useCallback } from 'react';
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

    const handleGenerateAIDraft = useCallback(async () => {
        if (!token || !currentAccount || isGeneratingDraft) return;

        setIsGeneratingDraft(true);
        try {
            const res = await fetch(`/api/chat/${conversationId}/ai-draft`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ currentDraft: currentInput || '' })
            });

            if (!res.ok) {
                const error = await res.json();
                alert(error.error || 'Failed to generate AI draft');
                return;
            }

            const data = await res.json();
            if (data.draft) {
                onDraftGenerated(data.draft);
            }
        } catch (error) {
            Logger.error('AI draft generation failed:', { error: error });
            alert('Failed to generate AI draft. Please try again.');
        } finally {
            setIsGeneratingDraft(false);
        }
    }, [token, currentAccount, conversationId, currentInput, onDraftGenerated, isGeneratingDraft]);

    return {
        isGeneratingDraft,
        handleGenerateAIDraft
    };
}
