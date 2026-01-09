/**
 * ChatSearchBar Component
 * Extracted from ChatWindow for better maintainability.
 * Provides message search functionality within a conversation.
 */

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
    return (
        <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
            <Search size={16} className="text-gray-400" aria-hidden="true" />
            <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search messages..."
                className="flex-1 text-sm outline-none"
                autoFocus
                aria-label="Search messages"
            />
            {searchQuery && (
                <span className="text-xs text-gray-400">
                    {matchCount} of {totalCount}
                </span>
            )}
            <button
                onClick={onClose}
                className="p-1 rounded hover:bg-gray-100 text-gray-400"
                aria-label="Close search"
            >
                <X size={14} />
            </button>
        </div>
    );
}
