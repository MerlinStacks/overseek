import { useState, useEffect, useRef } from 'react';
import { Tag, Plus, X, ChevronDown, Search, Loader2 } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface TagMapping {
    productTag: string;
    orderTag: string;
    enabled: boolean;
    color?: string;
}

interface OrderTagPanelProps {
    orderId: string;
    currentTags: string[];
    onTagsChange: (tags: string[]) => void;
}

/**
 * Sidebar panel for managing order tags.
 * Displays current tags with single-click removal and a dropdown to add available tags.
 */
export function OrderTagPanel({ orderId, currentTags, onTagsChange }: OrderTagPanelProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [mappings, setMappings] = useState<TagMapping[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const [showAddDropdown, setShowAddDropdown] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (currentAccount && token) {
            loadMappings();
        }
    }, [currentAccount, token]);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowAddDropdown(false);
                setSearchQuery('');
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    async function loadMappings() {
        if (!currentAccount || !token) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}/tag-mappings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setMappings((data.mappings || []).filter((m: TagMapping) => m.enabled));
            }
        } catch (error) {
            Logger.error('Failed to load tag mappings', { error });
        } finally {
            setIsLoading(false);
        }
    }

    /** Gets available tags that aren't already applied to this order */
    function getAvailableTags(): TagMapping[] {
        const appliedTags = new Set(currentTags.map(t => t.toLowerCase()));
        return mappings.filter(m => !appliedTags.has(m.orderTag.toLowerCase()));
    }

    /** Filtered available tags based on search */
    function getFilteredAvailableTags(): TagMapping[] {
        const available = getAvailableTags();
        if (!searchQuery.trim()) return available;
        return available.filter(m =>
            m.orderTag.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }

    /** Gets color for a tag from mappings */
    function getTagColor(tagName: string): string {
        const mapping = mappings.find(m => m.orderTag.toLowerCase() === tagName.toLowerCase());
        return mapping?.color || '#6B7280';
    }

    async function addTag(tagName: string) {
        if (!currentAccount || !token || isUpdating) return;
        setIsUpdating(true);
        setShowAddDropdown(false);
        setSearchQuery('');

        try {
            const res = await fetch(`/api/orders/${orderId}/tags`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tag: tagName })
            });

            if (res.ok) {
                const data = await res.json();
                onTagsChange(data.tags);
            }
        } catch (error) {
            Logger.error('Failed to add tag', { error });
        } finally {
            setIsUpdating(false);
        }
    }

    async function removeTag(tagName: string) {
        if (!currentAccount || !token || isUpdating) return;
        setIsUpdating(true);

        try {
            const res = await fetch(`/api/orders/${orderId}/tags/${encodeURIComponent(tagName)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (res.ok) {
                const data = await res.json();
                onTagsChange(data.tags);
            }
        } catch (error) {
            Logger.error('Failed to remove tag', { error });
        } finally {
            setIsUpdating(false);
        }
    }

    const availableTags = getFilteredAvailableTags();
    const hasAvailableTags = getAvailableTags().length > 0;

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">
            <div className="font-semibold text-gray-900 flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                    <Tag size={18} className="text-blue-500" />
                    Tags
                </div>

                {/* Add Tag Button */}
                {hasAvailableTags && (
                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setShowAddDropdown(!showAddDropdown)}
                            disabled={isUpdating || isLoading}
                            className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50"
                        >
                            <Plus size={14} />
                            Add
                            <ChevronDown size={12} className={`transition-transform ${showAddDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showAddDropdown && (
                            <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                                {/* Search input */}
                                <div className="p-2 border-b border-gray-100">
                                    <div className="relative">
                                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search tags..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            autoFocus
                                        />
                                    </div>
                                </div>

                                {/* Tag list */}
                                <div className="max-h-48 overflow-y-auto py-1">
                                    {availableTags.length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-gray-500 text-center">
                                            {searchQuery ? 'No matching tags' : 'No tags available'}
                                        </div>
                                    ) : (
                                        availableTags.map(mapping => (
                                            <button
                                                key={mapping.orderTag}
                                                onClick={() => addTag(mapping.orderTag)}
                                                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 transition-colors"
                                            >
                                                <span
                                                    className="w-3 h-3 rounded-sm flex-shrink-0"
                                                    style={{ backgroundColor: mapping.color || '#6B7280' }}
                                                />
                                                <span className="truncate">{mapping.orderTag}</span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Tags Display */}
            {isLoading ? (
                <div className="flex items-center justify-center py-4">
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                </div>
            ) : currentTags.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-2">
                    {mappings.length === 0 ? (
                        <span>Configure tag mappings in Settings</span>
                    ) : (
                        <span>No tags applied</span>
                    )}
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {currentTags.map((tag) => {
                        const color = getTagColor(tag);
                        return (
                            <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm text-white group"
                                style={{ backgroundColor: color }}
                            >
                                {tag}
                                <button
                                    onClick={() => removeTag(tag)}
                                    disabled={isUpdating}
                                    className="ml-0.5 p-0.5 rounded hover:bg-white/20 opacity-70 hover:opacity-100 transition-opacity disabled:opacity-50"
                                    title="Remove tag"
                                >
                                    {isUpdating ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                        <X size={12} />
                                    )}
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
