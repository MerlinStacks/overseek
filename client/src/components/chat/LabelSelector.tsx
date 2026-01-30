/**
 * LabelSelector
 * 
 * Dropdown component for selecting and assigning labels to conversations.
 * Shows current labels as colored chips with ability to add/remove.
 */

import { useState, useEffect, useRef } from 'react';
import { Logger } from '../../utils/logger';
import { Tag, Plus, X, Check, Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface Label {
    id: string;
    name: string;
    color: string;
}

interface LabelSelectorProps {
    conversationId: string;
    currentLabels: Label[];
    onLabelsChange?: (labels: Label[]) => void;
    compact?: boolean;
}

export function LabelSelector({
    conversationId,
    currentLabels,
    onLabelsChange,
    compact = false,
}: LabelSelectorProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isOpen, setIsOpen] = useState(false);
    const [allLabels, setAllLabels] = useState<Label[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fetch all available labels when dropdown opens
    useEffect(() => {
        if (isOpen && allLabels.length === 0) {
            fetchLabels();
        }
    }, [isOpen]);

    const fetchLabels = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/labels', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
            });
            if (res.ok) {
                const data = await res.json();
                setAllLabels(data.labels || []);
            }
        } catch (error) {
            Logger.error('Failed to fetch labels:', { error: error });
        } finally {
            setIsLoading(false);
        }
    };

    const isLabelAssigned = (labelId: string) => {
        return currentLabels.some((l) => l.id === labelId);
    };

    const handleToggleLabel = async (label: Label) => {
        const isAssigned = isLabelAssigned(label.id);
        setActionLoading(label.id);

        try {
            const method = isAssigned ? 'DELETE' : 'POST';
            const res = await fetch(`/api/chat/${conversationId}/labels/${label.id}`, {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount?.id || '',
                },
            });

            if (res.ok) {
                const newLabels = isAssigned
                    ? currentLabels.filter((l) => l.id !== label.id)
                    : [...currentLabels, label];
                onLabelsChange?.(newLabels);
            }
        } catch (error) {
            Logger.error('Failed to toggle label:', { error: error });
        } finally {
            setActionLoading(null);
        }
    };

    const handleRemoveLabel = async (labelId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const label = currentLabels.find((l) => l.id === labelId);
        if (label) {
            await handleToggleLabel(label);
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Current Labels Display */}
            <div className="flex flex-wrap items-center gap-1">
                {currentLabels.map((label) => (
                    <span
                        key={label.id}
                        className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                            compact ? 'text-[10px]' : 'text-xs'
                        )}
                        style={{
                            backgroundColor: `${label.color}20`,
                            color: label.color,
                            border: `1px solid ${label.color}40`,
                        }}
                    >
                        {label.name}
                        <button
                            onClick={(e) => handleRemoveLabel(label.id, e)}
                            className="ml-0.5 hover:opacity-70 transition-opacity"
                            aria-label={`Remove ${label.name} label`}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                ))}

                {/* Add Label Button */}
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                        'bg-gray-700/50 text-gray-400 border border-gray-600/50',
                        'hover:bg-gray-700 hover:text-gray-300 transition-colors'
                    )}
                    aria-label="Add label"
                >
                    <Plus className="w-3 h-3" />
                    {!compact && <span>Label</span>}
                </button>
            </div>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                        </div>
                    ) : allLabels.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">
                            No labels created yet
                        </div>
                    ) : (
                        <>
                            <div className="px-3 py-1.5 text-xs font-medium text-gray-500 uppercase">
                                Labels
                            </div>
                            {allLabels.map((label) => {
                                const isAssigned = isLabelAssigned(label.id);
                                const isLoadingThis = actionLoading === label.id;

                                return (
                                    <button
                                        key={label.id}
                                        onClick={() => handleToggleLabel(label)}
                                        disabled={isLoadingThis}
                                        className={cn(
                                            'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                                            'hover:bg-gray-700 transition-colors',
                                            isAssigned && 'bg-gray-700/50'
                                        )}
                                    >
                                        <span
                                            className="w-3 h-3 rounded-full"
                                            style={{ backgroundColor: label.color }}
                                        />
                                        <span className="flex-1 text-gray-200">{label.name}</span>
                                        {isLoadingThis ? (
                                            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                                        ) : isAssigned ? (
                                            <Check className="w-4 h-4 text-green-400" />
                                        ) : null}
                                    </button>
                                );
                            })}
                        </>
                    )}

                    {/* Create New Label Link */}
                    <div className="border-t border-gray-700 mt-1 pt-1">
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                // Could open label manager modal here
                                window.location.href = '/settings?tab=labels';
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                        >
                            <Tag className="w-4 h-4" />
                            Manage Labels
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
