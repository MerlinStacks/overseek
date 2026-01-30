/**
 * KeyboardShortcutsHelp - Modal showing all keyboard shortcuts
 */

import { X } from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '../../hooks/useKeyboardShortcuts';

interface KeyboardShortcutsHelpProps {
    isOpen: boolean;
    onClose: () => void;
}

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-900">Keyboard Shortcuts</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Shortcuts list */}
                <div className="p-6">
                    <div className="space-y-3">
                        {KEYBOARD_SHORTCUTS.map(shortcut => (
                            <div key={shortcut.key} className="flex items-center justify-between">
                                <span className="text-sm text-gray-600">{shortcut.description}</span>
                                <kbd className="px-2.5 py-1 bg-gray-100 border border-gray-200 rounded text-xs font-mono text-gray-700">
                                    {shortcut.key}
                                </kbd>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 rounded-b-xl border-t border-gray-100">
                    <p className="text-xs text-gray-500 text-center">
                        Press <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs">?</kbd> anytime to show this help
                    </p>
                </div>
            </div>
        </div>
    );
}
