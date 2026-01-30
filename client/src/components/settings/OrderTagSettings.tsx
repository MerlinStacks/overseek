import { useState, useEffect, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { Loader2, Save, Tag, Plus, X, ChevronDown, Search } from 'lucide-react';

interface TagMapping {
    productTag: string;
    orderTag: string;
    enabled: boolean;
    color?: string;  // Hex color for display (e.g. "#3B82F6")
}

/**
 * Settings component for configuring product tag to order tag mappings.
 * Compact UI: shows only added mappings with an "Add" button to add more.
 */
export function OrderTagSettings() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [productTags, setProductTags] = useState<string[]>([]);
    const [mappings, setMappings] = useState<TagMapping[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Add tag dropdown state
    const [showAddDropdown, setShowAddDropdown] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!currentAccount || !token) return;
        loadData();
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

    async function loadData() {
        if (!currentAccount || !token) return;
        setIsLoading(true);

        try {
            const [tagsRes, mappingsRes] = await Promise.all([
                fetch(`/api/accounts/${currentAccount.id}/product-tags`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/accounts/${currentAccount.id}/tag-mappings`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);

            const tagsData = await tagsRes.json();
            const mappingsData = await mappingsRes.json();

            setProductTags(tagsData.tags || []);
            setMappings(mappingsData.mappings || []);
        } catch (error) {
            Logger.error('Failed to load tag settings', { error: error });
        } finally {
            setIsLoading(false);
        }
    }

    /** Product tags not yet added as mappings */
    function getAvailableTags(): string[] {
        const mappedTags = new Set(mappings.map(m => m.productTag.toLowerCase()));
        return productTags.filter(tag => !mappedTags.has(tag.toLowerCase()));
    }

    /** Filtered available tags based on search */
    function getFilteredAvailableTags(): string[] {
        const available = getAvailableTags();
        if (!searchQuery.trim()) return available;
        return available.filter(tag =>
            tag.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }

    function addTagMapping(productTag: string) {
        setMappings(prev => [
            ...prev,
            { productTag, orderTag: productTag, enabled: true, color: '#3B82F6' }
        ]);
        setShowAddDropdown(false);
        setSearchQuery('');
    }

    function removeTagMapping(productTag: string) {
        setMappings(prev => prev.filter(m => m.productTag.toLowerCase() !== productTag.toLowerCase()));
    }

    function updateMapping(productTag: string, updates: Partial<TagMapping>) {
        setMappings(prev => prev.map(m =>
            m.productTag.toLowerCase() === productTag.toLowerCase()
                ? { ...m, ...updates }
                : m
        ));
    }

    async function handleSave() {
        if (!currentAccount || !token) return;
        setIsSaving(true);
        setMessage(null);

        try {
            const res = await fetch(`/api/accounts/${currentAccount.id}/tag-mappings`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mappings })
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'Tag mappings saved! Re-sync orders to apply changes.' });
            } else {
                throw new Error('Save failed');
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to save tag mappings' });
        } finally {
            setIsSaving(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="animate-spin text-blue-600" size={24} />
            </div>
        );
    }

    const availableTags = getFilteredAvailableTags();
    const hasUnmappedTags = getAvailableTags().length > 0;

    return (
        <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Tag className="text-blue-600" size={20} />
                        <div>
                            <h2 className="text-lg font-medium text-gray-900">Order Tag Mappings</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Configure which product tags should be applied to orders.
                            </p>
                        </div>
                    </div>

                    {/* Add Tag Button with Dropdown */}
                    {hasUnmappedTags && (
                        <div className="relative" ref={dropdownRef}>
                            <button
                                onClick={() => setShowAddDropdown(!showAddDropdown)}
                                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
                            >
                                <Plus size={16} />
                                Add Tag
                                <ChevronDown size={14} className={`transition-transform ${showAddDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            {showAddDropdown && (
                                <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                                    {/* Search input */}
                                    <div className="p-2 border-b border-gray-100">
                                        <div className="relative">
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="text"
                                                placeholder="Search tags..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                autoFocus
                                            />
                                        </div>
                                    </div>

                                    {/* Tag list */}
                                    <div className="max-h-60 overflow-y-auto py-1">
                                        {availableTags.length === 0 ? (
                                            <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                                {searchQuery ? 'No matching tags' : 'All tags have been added'}
                                            </div>
                                        ) : (
                                            availableTags.map(tag => (
                                                <button
                                                    key={tag}
                                                    onClick={() => addTagMapping(tag)}
                                                    className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 transition-colors"
                                                >
                                                    <Tag size={14} className="text-gray-400" />
                                                    <span className="truncate">{tag}</span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="p-6">
                {mappings.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Tag size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="font-medium">No tag mappings configured</p>
                        <p className="text-sm mt-1">
                            {productTags.length > 0
                                ? 'Click "Add Tag" to map product tags to order tags.'
                                : 'Sync your products to see available tags.'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* Header */}
                        <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-gray-500 uppercase px-2">
                            <div className="col-span-1">Active</div>
                            <div className="col-span-3">Product Tag</div>
                            <div className="col-span-1 text-center">→</div>
                            <div className="col-span-4">Order Tag Name</div>
                            <div className="col-span-2">Color</div>
                            <div className="col-span-1"></div>
                        </div>

                        {/* Mapping rows */}
                        {mappings.map(mapping => (
                            <div
                                key={mapping.productTag}
                                className={`grid grid-cols-12 gap-4 items-center p-3 rounded-lg border transition-colors ${mapping.enabled ? 'border-blue-200 bg-blue-50/50' : 'border-gray-200 bg-gray-50/50'
                                    }`}
                            >
                                <div className="col-span-1">
                                    <input
                                        type="checkbox"
                                        checked={mapping.enabled}
                                        onChange={(e) => updateMapping(mapping.productTag, { enabled: e.target.checked })}
                                        className="rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="col-span-3">
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                                        {mapping.productTag}
                                    </span>
                                </div>
                                <div className="col-span-1 text-center text-gray-400">→</div>
                                <div className="col-span-4">
                                    <input
                                        type="text"
                                        value={mapping.orderTag}
                                        onChange={(e) => updateMapping(mapping.productTag, { orderTag: e.target.value })}
                                        placeholder="Order tag name"
                                        className="w-full px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white border-gray-300"
                                    />
                                </div>
                                <div className="col-span-2 flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={mapping.color || '#6B7280'}
                                        onChange={(e) => updateMapping(mapping.productTag, { color: e.target.value })}
                                        className="w-8 h-8 rounded-sm cursor-pointer border border-gray-300"
                                        title="Tag color"
                                    />
                                    <span
                                        className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs text-white"
                                        style={{ backgroundColor: mapping.color || '#6B7280' }}
                                    >
                                        {mapping.orderTag || 'Preview'}
                                    </span>
                                </div>
                                <div className="col-span-1 flex justify-end">
                                    <button
                                        onClick={() => removeTagMapping(mapping.productTag)}
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                        title="Remove mapping"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {message && (
                    <div className={`mt-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                        }`}>
                        {message.text}
                    </div>
                )}

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save Mappings
                    </button>
                </div>
            </div>
        </div>
    );
}
