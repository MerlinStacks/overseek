/**
 * AutomationSettingsModal - Modal for configuring automation-level settings.
 * Accessible from trigger nodes, similar to FluentCRM's cart abandoned settings.
 * 
 * Features:
 * - Run mode: Once / Multiple Times per contact
 * - Re-entry options: Allow contacts to re-enter while active
 * - Execution mode: Immediate vs Queued batch processing
 */
import React, { useState, useEffect } from 'react';
import { X, Settings, RotateCcw, Users, Zap, Clock } from 'lucide-react';

interface AutomationSettings {
    runMode: 'ONCE' | 'MULTIPLE';
    allowReEntry: boolean;
    executionMode: 'IMMEDIATE' | 'QUEUED';
    batchSize?: number;
    batchInterval?: number;
}

interface AutomationSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    settings: AutomationSettings;
    onSave: (settings: AutomationSettings) => void;
    automationName?: string;
}

export const AutomationSettingsModal: React.FC<AutomationSettingsModalProps> = ({
    isOpen,
    onClose,
    settings,
    onSave,
    automationName = 'Automation'
}) => {
    const [localSettings, setLocalSettings] = useState<AutomationSettings>(settings);

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(localSettings);
        onClose();
    };

    const updateSetting = <K extends keyof AutomationSettings>(key: K, value: AutomationSettings[K]) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                            <Settings size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="font-bold text-gray-900">Automation Settings</h2>
                            <p className="text-xs text-gray-500">{automationName}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        <X size={18} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 space-y-5">
                    {/* Run Mode */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                            <Users size={16} />
                            Runs On Contact
                        </label>
                        <div className="flex gap-3">
                            <label className="flex-1">
                                <input
                                    type="radio"
                                    name="runMode"
                                    value="ONCE"
                                    checked={localSettings.runMode === 'ONCE'}
                                    onChange={() => updateSetting('runMode', 'ONCE')}
                                    className="sr-only peer"
                                />
                                <div className="p-3 border-2 rounded-lg cursor-pointer transition-all peer-checked:border-blue-500 peer-checked:bg-blue-50 hover:border-gray-300">
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 rounded-full border-2 peer-checked:border-blue-500 flex items-center justify-center">
                                            {localSettings.runMode === 'ONCE' && (
                                                <div className="w-2 h-2 rounded-full bg-blue-500" />
                                            )}
                                        </div>
                                        <span className="font-medium text-gray-900">Once</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1 ml-6">
                                        Each contact can only enter this automation once
                                    </p>
                                </div>
                            </label>
                            <label className="flex-1">
                                <input
                                    type="radio"
                                    name="runMode"
                                    value="MULTIPLE"
                                    checked={localSettings.runMode === 'MULTIPLE'}
                                    onChange={() => updateSetting('runMode', 'MULTIPLE')}
                                    className="sr-only peer"
                                />
                                <div className="p-3 border-2 rounded-lg cursor-pointer transition-all peer-checked:border-blue-500 peer-checked:bg-blue-50 hover:border-gray-300">
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center">
                                            {localSettings.runMode === 'MULTIPLE' && (
                                                <div className="w-2 h-2 rounded-full bg-blue-500" />
                                            )}
                                        </div>
                                        <span className="font-medium text-gray-900">Multiple Times</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1 ml-6">
                                        Contacts can re-enter each time trigger fires
                                    </p>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Re-entry Option */}
                    {localSettings.runMode === 'MULTIPLE' && (
                        <div className="pl-4 border-l-2 border-blue-200">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <div className="mt-0.5">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.allowReEntry}
                                        onChange={(e) => updateSetting('allowReEntry', e.target.checked)}
                                        className="w-5 h-5 rounded-sm border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <RotateCcw size={14} className="text-blue-600" />
                                        <span className="font-medium text-gray-900">
                                            Allow currently active contacts to re-enter again
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        If enabled, contacts already in this automation can enter again when the trigger fires
                                    </p>
                                </div>
                            </label>
                        </div>
                    )}

                    {/* Execution Mode */}
                    <div className="pt-4 border-t">
                        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                            <Zap size={16} />
                            Execution Mode
                        </label>
                        <div className="space-y-2">
                            <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                <input
                                    type="radio"
                                    name="executionMode"
                                    value="IMMEDIATE"
                                    checked={localSettings.executionMode === 'IMMEDIATE'}
                                    onChange={() => updateSetting('executionMode', 'IMMEDIATE')}
                                    className="mt-0.5 w-4 h-4 text-blue-600"
                                />
                                <div>
                                    <div className="font-medium text-gray-900">Run immediately</div>
                                    <p className="text-xs text-gray-500">
                                        Contacts enter the flow as soon as the trigger fires
                                    </p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                                <input
                                    type="radio"
                                    name="executionMode"
                                    value="QUEUED"
                                    checked={localSettings.executionMode === 'QUEUED'}
                                    onChange={() => updateSetting('executionMode', 'QUEUED')}
                                    className="mt-0.5 w-4 h-4 text-blue-600"
                                />
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-gray-900">Queue for batch processing</span>
                                        <Clock size={12} className="text-gray-400" />
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        Contacts are queued and processed in batches to reduce server load
                                    </p>
                                </div>
                            </label>
                        </div>

                        {/* Batch settings when queued is selected */}
                        {localSettings.executionMode === 'QUEUED' && (
                            <div className="mt-3 p-3 bg-gray-50 rounded-lg border space-y-3">
                                <div className="flex items-center gap-3">
                                    <label className="text-sm text-gray-600">Batch size:</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={localSettings.batchSize || 10}
                                        onChange={(e) => updateSetting('batchSize', parseInt(e.target.value) || 10)}
                                        className="w-20 px-2 py-1 border rounded-sm text-sm"
                                    />
                                    <span className="text-xs text-gray-500">contacts per batch</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <label className="text-sm text-gray-600">Interval:</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="60"
                                        value={localSettings.batchInterval || 5}
                                        onChange={(e) => updateSetting('batchInterval', parseInt(e.target.value) || 5)}
                                        className="w-20 px-2 py-1 border rounded-sm text-sm"
                                    />
                                    <span className="text-xs text-gray-500">minutes between batches</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-5 py-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AutomationSettingsModal;
