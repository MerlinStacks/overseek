/**
 * ChatSearchBar Component
 * Extracted from ChatWindow for better maintainability.
 * Provides message search functionality within a conversation.
 */

import { useId, useRef } from 'react';
import { Search, X } from 'lucide-react';

interface ChatSearchBarProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onClose: () => void;
    matchCount: number;
    totalCount: number;
}

export function ChatSearchBar({
    searchQuery,
    onSearchChange,
    onClose,
    matchCount,
    totalCount
}: ChatSearchBarProps) {
    const composing = useRef(false);
    const scopeId = useId();
    return (
        <div className="px-4 py-2 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-wrap items-center gap-2" onKeyDown={event => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || composing.current) return;
            event.preventDefault(); event.stopPropagation(); onClose();
        }}>
            <Search size={16} className="text-gray-400" aria-hidden="true" />
            <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search messages..."
                className="min-w-0 flex-1 text-sm outline-hidden dark:bg-slate-800 dark:text-slate-100"
                autoFocus
                aria-label="Search messages"
                aria-describedby={scopeId}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
            />
            {searchQuery && (
                <span role="status" aria-live="polite" className="text-xs text-gray-500 dark:text-slate-400">
                    {matchCount} of {totalCount} loaded messages
                </span>
            )}
            <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-sm hover:bg-gray-100 text-gray-400"
                aria-label="Close search"
            >
                <X size={14} />
            </button>
            <span id={scopeId} className="basis-full text-xs text-gray-500 dark:text-slate-400">Searches loaded messages only.</span>
        </div>
    );
}
