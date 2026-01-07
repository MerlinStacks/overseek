
import React, { useRef, useState } from 'react';
import EmailEditor, { EditorRef } from 'react-email-editor';
import { X, Save, Mail } from 'lucide-react';

interface Props {
    initialDesign?: any;
    onSave: (html: string, design: any) => void;
    onCancel: () => void;
}

export const EmailDesignEditor: React.FC<Props> = ({ initialDesign, onSave, onCancel }) => {
    const emailEditorRef = useRef<EditorRef>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const exportHtml = () => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        setSaving(true);
        editor.exportHtml((data) => {
            const { design, html } = data;
            onSave(html, design);
            setSaving(false);
        });
    };

    const onLoad = () => {
        // Editor script loaded
    };

    const onReady = () => {
        // Editor is fully ready - hide loading
        setLoading(false);
        if (initialDesign && emailEditorRef.current?.editor) {
            emailEditorRef.current.editor.loadDesign(initialDesign);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/50 backdrop-blur-sm">
            {/* Full Screen Container */}
            <div className="flex flex-col h-full w-full bg-white overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg">
                            <Mail size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Email Designer</h2>
                            <p className="text-xs text-blue-100 hidden sm:block">Drag and drop to build your email</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onCancel}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 transition-colors"
                        >
                            <X size={16} />
                            <span className="hidden sm:inline">Cancel</span>
                        </button>
                        <button
                            onClick={exportHtml}
                            disabled={loading || saving}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-600 bg-white rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? (
                                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <Save size={16} />
                            )}
                            <span className="hidden sm:inline">Save Design</span>
                        </button>
                    </div>
                </div>

                {/* Editor Container - Use absolute positioning for iframe */}
                <div className="flex-1 relative bg-gray-100">
                    {/* Loading Overlay */}
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white z-20">
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative">
                                    <div className="w-16 h-16 border-4 border-blue-100 rounded-full"></div>
                                    <div className="absolute inset-0 w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                </div>
                                <div className="text-center">
                                    <p className="text-gray-700 font-semibold">Loading Email Editor</p>
                                    <p className="text-gray-400 text-sm mt-1">Setting up your design tools...</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Unlayer Email Editor - absolutely positioned to fill parent */}
                    <div className="absolute inset-0">
                        <EmailEditor
                            ref={emailEditorRef}
                            onLoad={onLoad}
                            onReady={onReady}
                            minHeight="100%"
                            style={{
                                height: '100%',
                                width: '100%',
                                minHeight: '100%'
                            }}
                            options={{
                                appearance: {
                                    theme: 'light',
                                    panels: {
                                        tools: {
                                            dock: 'left'
                                        }
                                    }
                                },
                                features: {
                                    textEditor: {
                                        spellChecker: true
                                    }
                                },
                                displayMode: 'email'
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
