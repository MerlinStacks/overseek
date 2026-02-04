/**
 * KeyboardShortcutsHelp - Modal showing all keyboard shortcuts
 */

import { Modal } from '../ui/Modal';
import { KEYBOARD_SHORTCUTS } from '../../hooks/useKeyboardShortcuts';

interface KeyboardShortcutsHelpProps {
    isOpen: boolean;
    onClose: () => void;
}

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Keyboard Shortcuts"
            maxWidth="max-w-md"
        >
            {/* Shortcuts list */}
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

            {/* Footer */}
            <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 text-center">
                    Press <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-xs">?</kbd> anytime to show this help
                </p>
            </div>
        </Modal>
    );
}
