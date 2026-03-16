/**
 * Hook for managing inbox message drafts in localStorage.
 * Drafts are persisted per-conversation and auto-restored when switching threads.
 */
import { useCallback, useRef, useEffect } from 'react';
import { debounce } from '../utils/debounce';

const DRAFT_KEY_PREFIX = 'inbox_draft_';

/**
 * Performs the actual localStorage write for a draft.
 * Extracted so the debounced wrapper can call it with current args.
 */
function writeDraft(conversationId: string, content: string): void {
    try {
        const key = `${DRAFT_KEY_PREFIX}${conversationId}`;
        const plainText = content.replace(/<[^>]*>/g, '').trim();
        if (plainText) {
            localStorage.setItem(key, content);
        } else {
            localStorage.removeItem(key);
        }
    } catch {
        // Silently fail if localStorage is full/unavailable
    }
}

/**
 * Returns draft management functions for inbox conversations.
 * Drafts are stored in localStorage keyed by conversation ID.
 */
export function useDrafts() {
    // Store latest args so the single debounced function always writes the
    // most recent values when it fires.
    const latestArgsRef = useRef<{ conversationId: string; content: string }>({
        conversationId: '',
        content: ''
    });

    // Create the debounced writer exactly once and reuse it.
    const debouncedSaveRef = useRef(
        debounce(() => {
            const { conversationId, content } = latestArgsRef.current;
            if (conversationId) writeDraft(conversationId, content);
        }, 500)
    );

    // Cleanup on unmount
    useEffect(() => {
        const fn = debouncedSaveRef.current;
        return () => fn.cancel();
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
        latestArgsRef.current = { conversationId, content };
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
