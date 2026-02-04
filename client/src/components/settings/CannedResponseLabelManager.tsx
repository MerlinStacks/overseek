/**
 * CannedResponseLabelManager
 * 
 * Panel for managing canned response labels (colors and names).
 */
import React from 'react';
import { Plus, Trash2, Edit2, Save, X, Palette } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface CannedResponseLabel {
    id: string;
    name: string;
    color: string;
}

interface LabelManagerProps {
    labels: CannedResponseLabel[];
    editingLabelId: string | null;
    newLabelName: string;
    newLabelColor: string;
    onLabelsChange: (labels: CannedResponseLabel[]) => void;
    onEditingLabelIdChange: (id: string | null) => void;
    onNewLabelNameChange: (name: string) => void;
    onNewLabelColorChange: (color: string) => void;
    onCreateLabel: () => void;
    onUpdateLabel: (id: string, name: string, color: string) => void;
    onDeleteLabel: (id: string) => void;
    onRefreshLabels: () => void;
}

const PRESET_COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b'];

export function CannedResponseLabelManager({
    labels, editingLabelId, newLabelName, newLabelColor,
    onLabelsChange, onEditingLabelIdChange, onNewLabelNameChange, onNewLabelColorChange,
    onCreateLabel, onUpdateLabel, onDeleteLabel, onRefreshLabels
}: LabelManagerProps) {
    return (
        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-200">
            <h3 className="text-sm font-medium text-indigo-900 mb-3">Labels</h3>

            {/* Existing Labels */}
            <div className="space-y-2 mb-4">
                {labels.map(label => (
                    <div key={label.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-indigo-100">
                        {editingLabelId === label.id ? (
                            <>
                                <input
                                    type="color"
                                    value={label.color}
                                    onChange={(e) => onLabelsChange(labels.map(l => l.id === label.id ? { ...l, color: e.target.value } : l))}
                                    className="w-6 h-6 rounded cursor-pointer"
                                />
                                <input
                                    type="text"
                                    value={label.name}
                                    onChange={(e) => onLabelsChange(labels.map(l => l.id === label.id ? { ...l, name: e.target.value } : l))}
                                    className="flex-1 px-2 py-1 border rounded text-sm"
                                />
                                <button onClick={() => onUpdateLabel(label.id, label.name, label.color)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Save size={14} /></button>
                                <button onClick={() => { onEditingLabelIdChange(null); onRefreshLabels(); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={14} /></button>
                            </>
                        ) : (
                            <>
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: label.color }} />
                                <span className="flex-1 text-sm text-gray-700">{label.name}</span>
                                <button onClick={() => onEditingLabelIdChange(label.id)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Edit2 size={14} /></button>
                                <button onClick={() => onDeleteLabel(label.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                            </>
                        )}
                    </div>
                ))}
                {labels.length === 0 && <p className="text-sm text-indigo-600 italic">No labels yet. Create one below.</p>}
            </div>

            {/* Create New Label */}
            <div className="flex items-center gap-2">
                <div className="relative">
                    <button
                        className="w-8 h-8 rounded-lg border-2 border-dashed border-indigo-300 flex items-center justify-center hover:border-indigo-400"
                        style={{ backgroundColor: newLabelColor }}
                        onClick={() => document.getElementById('new-label-color')?.click()}
                    >
                        <Palette size={14} className="text-white drop-shadow" />
                    </button>
                    <input
                        id="new-label-color"
                        type="color"
                        value={newLabelColor}
                        onChange={(e) => onNewLabelColorChange(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                </div>
                <div className="flex gap-1">
                    {PRESET_COLORS.map(color => (
                        <button
                            key={color}
                            onClick={() => onNewLabelColorChange(color)}
                            className={cn("w-5 h-5 rounded-full transition-transform", newLabelColor === color && "ring-2 ring-offset-1 ring-indigo-500 scale-110")}
                            style={{ backgroundColor: color }}
                        />
                    ))}
                </div>
                <input
                    type="text"
                    placeholder="New label name..."
                    value={newLabelName}
                    onChange={(e) => onNewLabelNameChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onCreateLabel()}
                    className="flex-1 px-3 py-1.5 border border-indigo-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                />
                <button onClick={onCreateLabel} disabled={!newLabelName.trim()} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                    <Plus size={14} />Add
                </button>
            </div>
        </div>
    );
}
