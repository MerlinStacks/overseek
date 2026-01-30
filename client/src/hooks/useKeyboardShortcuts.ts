/**
 * useKeyboardShortcuts - Global keyboard shortcuts for inbox navigation
 * 
 * Shortcuts:
 * - J/K: Navigate up/down in conversation list
 * - E: Close/resolve selected conversation  
 * - O: Re-open selected conversation
 * - A: Open assign modal
 * - R: Focus reply input
 * - /: Focus search input
 * - ?: Show keyboard shortcuts help
 */

import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsOptions {
    conversations: { id: string }[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onClose?: () => void;
    onReopen?: () => void;
    onAssign?: () => void;
    onFocusReply?: () => void;
    onFocusSearch?: () => void;
    onShowHelp?: () => void;
    enabled?: boolean;
}

export function useKeyboardShortcuts({
    conversations,
    selectedId,
    onSelect,
    onClose,
    onReopen,
    onAssign,
    onFocusReply,
    onFocusSearch,
    onShowHelp,
    enabled = true
}: KeyboardShortcutsOptions) {

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        // Don't intercept browser shortcuts that use modifier keys
        if (e.ctrlKey || e.metaKey) return;

        // Don't handle if user is typing in an input/textarea
        const target = e.target as HTMLElement;
        const isTyping = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;

        // Allow only specific shortcuts when typing
        if (isTyping) {
            // Escape should blur inputs
            if (e.key === 'Escape') {
                (target as HTMLInputElement).blur();
            }
            return;
        }

        const currentIndex = selectedId
            ? conversations.findIndex(c => c.id === selectedId)
            : -1;

        switch (e.key.toLowerCase()) {
            case 'j':
                // Next conversation
                e.preventDefault();
                if (currentIndex < conversations.length - 1) {
                    const nextId = conversations[currentIndex + 1]?.id;
                    if (nextId) onSelect(nextId);
                } else if (currentIndex === -1 && conversations.length > 0) {
                    onSelect(conversations[0].id);
                }
                break;

            case 'k':
                // Previous conversation
                e.preventDefault();
                if (currentIndex > 0) {
                    const prevId = conversations[currentIndex - 1]?.id;
                    if (prevId) onSelect(prevId);
                }
                break;

            case 'e':
                // Close/resolve conversation
                e.preventDefault();
                onClose?.();
                break;

            case 'o':
                // Re-open conversation
                e.preventDefault();
                onReopen?.();
                break;

            case 'a':
                // Open assign modal
                e.preventDefault();
                onAssign?.();
                break;

            case 'r':
                // Focus reply input
                e.preventDefault();
                onFocusReply?.();
                break;

            case '/':
                // Focus search
                e.preventDefault();
                onFocusSearch?.();
                break;

            case '?':
                // Show help
                e.preventDefault();
                onShowHelp?.();
                break;
        }
    }, [conversations, selectedId, onSelect, onClose, onReopen, onAssign, onFocusReply, onFocusSearch, onShowHelp]);

    useEffect(() => {
        if (!enabled) return;

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown, enabled]);
}

// Shortcut definitions for help modal
export const KEYBOARD_SHORTCUTS = [
    { key: 'J', description: 'Next conversation' },
    { key: 'K', description: 'Previous conversation' },
    { key: 'E', description: 'Close/resolve conversation' },
    { key: 'O', description: 'Re-open conversation' },
    { key: 'A', description: 'Assign conversation' },
    { key: 'R', description: 'Focus reply box' },
    { key: '/', description: 'Search conversations' },
    { key: '?', description: 'Show keyboard shortcuts' },
    { key: 'Esc', description: 'Exit input field' }
];
