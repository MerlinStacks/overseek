import { useState, useRef, useEffect } from 'react';
import { Bookmark, ChevronDown, Plus, Trash2, X, Check } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useSavedViews, SavedView } from '../../hooks/useSavedViews';

interface SavedViewsDropdownProps {
    /** Context for the saved views (e.g., 'orders', 'customers') */
    context: string;
    /** Current filter state to save when creating a new view */
    currentFilters: Record<string, unknown>;
    /** Callback when a view is applied */
    onApplyView: (filters: Record<string, unknown>) => void;
    /** Additional CSS classes */
    className?: string;
}

/**
 * SavedViewsDropdown - UI for managing saved filter presets.
 * Allows users to save, select, rename, and delete filter views.
 * 
 * @example
 * <SavedViewsDropdown
 *   context="orders"
 *   currentFilters={{ status: 'processing', tags: ['priority'] }}
 *   onApplyView={(filters) => setFilters(filters)}
 * />
 */
export function SavedViewsDropdown({
    context,
    currentFilters,
    onApplyView,
    className
}: SavedViewsDropdownProps) {
    const { views, activeView, saveCurrentView, applyView, removeView, clearActiveView } = useSavedViews(context);

    const [isOpen, setIsOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [newViewName, setNewViewName] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setIsCreating(false);
                setConfirmDeleteId(null);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Focus input when creating
    useEffect(() => {
        if (isCreating && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isCreating]);

    const handleSaveView = () => {
        if (!newViewName.trim()) return;

        const savedView = saveCurrentView(newViewName.trim(), currentFilters);
        setNewViewName('');
        setIsCreating(false);
    };

    const handleApplyView = (view: SavedView) => {
        applyView(view.id);
        onApplyView(view.filters);
        setIsOpen(false);
    };

    const handleClearView = () => {
        clearActiveView();
        setIsOpen(false);
    };

    const handleDeleteView = (viewId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirmDeleteId === viewId) {
            removeView(viewId);
            setConfirmDeleteId(null);
        } else {
            setConfirmDeleteId(viewId);
        }
    };

    const hasActiveFilters = Object.values(currentFilters).some(
        (v) => v !== null && v !== undefined && v !== '' && v !== 'all' &&
            !(Array.isArray(v) && v.length === 0)
    );

    return (
        <div ref={dropdownRef} className={cn("relative", className)}>
            {/* Trigger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-sm font-medium",
                    activeView
                        ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                )}
            >
                <Bookmark size={16} className={activeView ? "fill-blue-600" : ""} />
                <span className="hidden sm:inline">
                    {activeView ? activeView.name : 'Saved Views'}
                </span>
                {views.length > 0 && !activeView && (
                    <span className="bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                        {views.length}
                    </span>
                )}
                <ChevronDown
                    size={14}
                    className={cn("transition-transform", isOpen && "rotate-180")}
                />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                Saved Views
                            </span>
                            {activeView && (
                                <button
                                    onClick={handleClearView}
                                    className="text-xs text-blue-600 hover:underline"
                                >
                                    Clear filter
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Views List */}
                    <div className="max-h-64 overflow-y-auto">
                        {views.length === 0 && !isCreating ? (
                            <div className="px-4 py-6 text-center text-gray-500">
                                <Bookmark size={24} className="mx-auto mb-2 text-gray-300" />
                                <p className="text-sm">No saved views yet</p>
                                <p className="text-xs text-gray-400 mt-1">
                                    Save your current filters for quick access
                                </p>
                            </div>
                        ) : (
                            views.map((view) => (
                                <div
                                    key={view.id}
                                    onClick={() => handleApplyView(view)}
                                    className={cn(
                                        "flex items-center justify-between px-4 py-3 cursor-pointer transition-colors group",
                                        activeView?.id === view.id
                                            ? "bg-blue-50"
                                            : "hover:bg-gray-50"
                                    )}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        {activeView?.id === view.id && (
                                            <Check size={14} className="text-blue-600 shrink-0" />
                                        )}
                                        <div className="min-w-0">
                                            <p className={cn(
                                                "text-sm font-medium truncate",
                                                activeView?.id === view.id ? "text-blue-700" : "text-gray-900"
                                            )}>
                                                {view.name}
                                            </p>
                                            {view.isDefault && (
                                                <span className="text-xs text-gray-400">Default</span>
                                            )}
                                        </div>
                                    </div>

                                    {!view.isDefault && (
                                        <button
                                            onClick={(e) => handleDeleteView(view.id, e)}
                                            className={cn(
                                                "p-1.5 rounded transition-colors shrink-0",
                                                confirmDeleteId === view.id
                                                    ? "bg-red-100 text-red-600"
                                                    : "text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100"
                                            )}
                                            title={confirmDeleteId === view.id ? "Click again to confirm" : "Delete view"}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    {/* Create New View */}
                    <div className="border-t border-gray-100">
                        {isCreating ? (
                            <div className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={newViewName}
                                        onChange={(e) => setNewViewName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveView();
                                            if (e.key === 'Escape') {
                                                setIsCreating(false);
                                                setNewViewName('');
                                            }
                                        }}
                                        placeholder="View name..."
                                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    />
                                    <button
                                        onClick={handleSaveView}
                                        disabled={!newViewName.trim()}
                                        className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Check size={16} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsCreating(false);
                                            setNewViewName('');
                                        }}
                                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setIsCreating(true)}
                                disabled={!hasActiveFilters}
                                className={cn(
                                    "w-full flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
                                    hasActiveFilters
                                        ? "text-blue-600 hover:bg-blue-50"
                                        : "text-gray-400 cursor-not-allowed"
                                )}
                            >
                                <Plus size={16} />
                                Save current view
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
