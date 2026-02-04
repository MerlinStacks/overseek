/**
 * CannedResponseList
 * 
 * Display component for grouped canned responses with actions.
 */
import React from 'react';
import { Trash2, Edit2, Tag } from 'lucide-react';
import { cn } from '../../utils/cn';
import DOMPurify from 'dompurify';
import { CannedResponseLabel } from './CannedResponseLabelManager';

export interface CannedResponse {
    id: string;
    shortcut: string;
    content: string;
    labelId: string | null;
    label: CannedResponseLabel | null;
}

interface ResponseGroup {
    name: string;
    label: CannedResponseLabel | null;
    items: CannedResponse[];
}

interface CannedResponseListProps {
    groups: ResponseGroup[];
    editingId: string | null;
    isLoading: boolean;
    searchQuery: string;
    onEdit: (response: CannedResponse) => void;
    onDelete: (id: string) => void;
}

export function CannedResponseList({
    groups, editingId, isLoading, searchQuery, onEdit, onDelete
}: CannedResponseListProps) {
    if (isLoading) {
        return <div className="text-center py-8 text-gray-500">Loading...</div>;
    }

    if (groups.length === 0) {
        return (
            <div className="text-center py-8 text-gray-500">
                {searchQuery ? 'No responses match your search.' : 'No canned responses yet. Add your first one above!'}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {groups.map(({ name, label, items }) => (
                <div key={name}>
                    <div className="flex items-center gap-2 mb-2">
                        {label ? (
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: label.color }} />
                        ) : (
                            <Tag size={14} className="text-gray-400" />
                        )}
                        <h4 className="text-sm font-medium text-gray-700">{name}</h4>
                        <span className="text-xs text-gray-400">({items.length})</span>
                    </div>
                    <div className="space-y-2">
                        {items.map((response) => (
                            <div
                                key={response.id}
                                className={cn(
                                    "bg-white border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition-colors",
                                    editingId === response.id && "ring-2 ring-blue-500/20 border-blue-500"
                                )}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <code className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono">
                                                /{response.shortcut}
                                            </code>
                                            {response.label && (
                                                <span
                                                    className="px-1.5 py-0.5 rounded text-xs text-white"
                                                    style={{ backgroundColor: response.label.color }}
                                                >
                                                    {response.label.name}
                                                </span>
                                            )}
                                        </div>
                                        <div
                                            className="text-sm text-gray-600 line-clamp-2 prose prose-sm max-w-none"
                                            dangerouslySetInnerHTML={{
                                                __html: DOMPurify.sanitize(response.content, {
                                                    ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li', 'a'],
                                                    ALLOWED_ATTR: ['href', 'target']
                                                })
                                            }}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => onEdit(response)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="Edit">
                                            <Edit2 size={14} />
                                        </button>
                                        <button onClick={() => onDelete(response.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Delete">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
