/**
 * Hook for managing inbox message drafts in localStorage.
 * Drafts are persisted per-conversation and auto-restored when switching threads.
 */
import { useCallback, useRef, useEffect } from 'react';
import { debounce } from '../utils/debounce';

const DRAFT_KEY_PREFIX = 'inbox_draft_';

/**
 * Returns draft management functions for inbox conversations.
 * Drafts are stored in localStorage keyed by conversation ID.
 */
export function useDrafts() {
    // Debounced save ref to prevent excessive writes
    const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null);

    // Cleanup debounced function on unmount
    useEffect(() => {
        return () => {
            debouncedSaveRef.current?.cancel();
        };
    }, []);

    /**
     * Retrieves the saved draft for a conversation.
     */
    const getDraft = useCallback((conversationId: string): string => {
        if (!conversationId) return '';
        try {
            return localStorage.getItem(`${DRAFT_KEY_PREFIX}${conversationId}`) || '';
        } catch {
            return '';
        }
    }, []);

    /**
     * Saves a draft for a conversation (debounced to reduce writes).
     */
    const saveDraft = useCallback((conversationId: string, content: string) => {
        if (!conversationId) return;

        // Cancel any pending save
        debouncedSaveRef.current?.cancel();

        // Create new debounced save
        debouncedSaveRef.current = debounce(() => {
            try {
                const key = `${DRAFT_KEY_PREFIX}${conversationId}`;
                // Strip HTML to check if there's actual content
                const plainText = content.replace(/<[^>]*>/g, '').trim();

                if (plainText) {
                    localStorage.setItem(key, content);
                } else {
                    // Remove empty drafts
                    localStorage.removeItem(key);
                }
            } catch {
                // Silently fail if localStorage is full/unavailable
            }
        }, 500);

        debouncedSaveRef.current();
    }, []);

    /**
     * Clears the draft for a conversation (call after sending).
     */
    const clearDraft = useCallback((conversationId: string) => {
        if (!conversationId) return;
        debouncedSaveRef.current?.cancel();
        try {
            localStorage.removeItem(`${DRAFT_KEY_PREFIX}${conversationId}`);
        } catch {
            // Silently fail
        }
    }, []);

    /**
     * Checks if a conversation has a saved draft.
     */
    const hasDraft = useCallback((conversationId: string): boolean => {
        if (!conversationId) return false;
        try {
            const draft = localStorage.getItem(`${DRAFT_KEY_PREFIX}${conversationId}`);
            if (!draft) return false;
            // Check for actual content
            const plainText = draft.replace(/<[^>]*>/g, '').trim();
            return plainText.length > 0;
        } catch {
            return false;
        }
    }, []);

    return { getDraft, saveDraft, clearDraft, hasDraft };
}
