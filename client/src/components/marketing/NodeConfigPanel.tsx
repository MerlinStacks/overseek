/**
 * NodeConfigPanel - Slide-out configuration panel for flow nodes.
 * Opens when a node is selected, showing type-specific configuration options.
 */
import React, { useState, useEffect } from 'react';
import { Node } from '@xyflow/react';
import { X, Trash2, Zap, Mail, Clock, Split, Save } from 'lucide-react';
import { TriggerConfig, ActionConfig, DelayConfig, ConditionConfig } from './nodeConfigs';

interface NodeConfigPanelProps {
    node: Node | null;
    onClose: () => void;
    onUpdate: (nodeId: string, data: any) => void;
    onDelete: (nodeId: string) => void;
}

export const NodeConfigPanel: React.FC<NodeConfigPanelProps> = ({
    node,
    onClose,
    onUpdate,
    onDelete
}) => {
    const [localData, setLocalData] = useState<any>({});

    // Sync local state when node changes
    useEffect(() => {
        if (node) {
            setLocalData({ ...node.data });
        }
    }, [node]);

    if (!node) return null;

    const handleSave = () => {
        onUpdate(node.id, localData);
    };

    const handleDelete = () => {
        if (confirm('Delete this node?')) {
            onDelete(node.id);
        }
    };

    const updateConfig = (key: string, value: any) => {
        setLocalData((prev: any) => ({
            ...prev,
            config: { ...prev.config, [key]: value }
        }));
    };

    const updateLabel = (label: string) => {
        setLocalData((prev: any) => ({ ...prev, label }));
    };

    // Get panel title and icon based on node type
    const getPanelHeader = () => {
        switch (node.type) {
            case 'trigger':
                return { title: 'Configure Trigger', subtitle: 'Entry point for this automation', icon: <Zap size={18} className="text-blue-600" />, color: 'blue' };
            case 'action':
                return { title: 'Configure Action', subtitle: 'Perform an action in the flow', icon: <Mail size={18} className="text-green-600" />, color: 'green' };
            case 'delay':
                return { title: 'Configure Delay', subtitle: 'Add a time delay before continuing', icon: <Clock size={18} className="text-yellow-600" />, color: 'yellow' };
            case 'condition':
                return { title: 'Configure Condition', subtitle: 'Branch based on conditions', icon: <Split size={18} className="text-orange-600" />, color: 'orange' };
            default:
                return { title: 'Configure Node', subtitle: 'Configure this step', icon: null, color: 'gray' };
        }
    };

    const header = getPanelHeader();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg bg-${header.color}-100`}>
                            {header.icon}
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">{localData.label || header.title}</h3>
                            <p className="text-sm text-gray-500">{header.subtitle}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Common: Label */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                        <input
                            type="text"
                            value={localData.label || ''}
                            onChange={(e) => updateLabel(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>

                    {/* Trigger-specific config */}
                    {node.type === 'trigger' && (
                        <TriggerConfig
                            config={localData.config || {}}
                            onUpdate={updateConfig}
                        />
                    )}

                    {/* Action-specific config */}
                    {node.type === 'action' && (
                        <ActionConfig
                            config={localData.config || {}}
                            onUpdate={updateConfig}
                        />
                    )}

                    {/* Delay-specific config */}
                    {node.type === 'delay' && (
                        <DelayConfig
                            config={localData.config || {}}
                            onUpdate={updateConfig}
                        />
                    )}

                    {/* Condition-specific config */}
                    {node.type === 'condition' && (
                        <ConditionConfig
                            config={localData.config || {}}
                            onUpdate={updateConfig}
                        />
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
                    <button
                        onClick={handleDelete}
                        className="flex items-center gap-1.5 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
                    >
                        <Trash2 size={16} />
                        Delete
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                        >
                            <Save size={16} />
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
