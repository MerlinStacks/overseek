import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmailEditor, { EditorRef } from 'react-email-editor';
import {
    AlertTriangle,
    ClipboardList,
    History,
    Loader2,
    Mail,
    Monitor,
    Save,
    Send,
    Smartphone,
    Tablet,
    Undo2,
    X,
} from 'lucide-react';
import { registerWooCommerceTools, getWooCommerceMergeTags } from '../../lib/unlayerWooCommerceTools';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { evaluateEmailPreflight, groupPreflightIssues, type PreflightIssue } from '../../utils/emailPreflight';

interface Props {
    initialDesign?: unknown;
    onSave: (html: string, design: unknown) => void;
    onCancel: () => void;
}

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

interface DesignSnapshot {
    id: string;
    createdAt: string;
    design: unknown;
}

const DRAFT_STORAGE_KEY = 'overseek-email-builder-draft';
const HISTORY_STORAGE_KEY = 'overseek-email-builder-history';
const RECENT_TEST_RECIPIENTS_KEY = 'overseek-email-builder-recent-recipients';
const MAX_HISTORY_SNAPSHOTS = 8;
const MAX_TEST_RECIPIENTS = 6;

const PRESET_ROWS: Record<string, { label: string; row: Record<string, unknown> }> = {
    productSpotlight: {
        label: 'Product Spotlight',
        row: {
            id: 'preset-product-spotlight',
            cells: [1],
            columns: [{
                id: 'preset-product-spotlight-col',
                contents: [{
                    id: 'preset-product-spotlight-title',
                    type: 'text',
                    values: {
                        text: '<h2 style="margin:0;text-align:center;line-height:1.3;">Featured Product This Week</h2>',
                        padding: '26px 24px 8px',
                    }
                }, {
                    id: 'preset-product-spotlight-copy',
                    type: 'text',
                    values: {
                        text: '<p style="margin:0;text-align:center;line-height:1.6;">Insert a WooCommerce product block below and highlight what makes it a must-have.</p>',
                        padding: '0px 24px 20px',
                    }
                }]
            }],
            values: { backgroundColor: '#ffffff', padding: '0px' }
        }
    },
    couponStrip: {
        label: 'Coupon Strip',
        row: {
            id: 'preset-coupon-strip',
            cells: [1],
            columns: [{
                id: 'preset-coupon-strip-col',
                contents: [{
                    id: 'preset-coupon-title',
                    type: 'text',
                    values: {
                        text: '<p style="margin:0;text-align:center;font-size:18px;"><strong>Use code SAVE15 for 15% off this week</strong></p>',
                        padding: '16px 20px 6px',
                    }
                }, {
                    id: 'preset-coupon-sub',
                    type: 'text',
                    values: {
                        text: '<p style="margin:0;text-align:center;line-height:1.55;">Replace this text with your coupon details and expiry date.</p>',
                        padding: '0px 20px 16px',
                    }
                }]
            }],
            values: { backgroundColor: '#eff6ff', padding: '0px' }
        }
    },
    reviewRequest: {
        label: 'Review Request',
        row: {
            id: 'preset-review-request',
            cells: [1],
            columns: [{
                id: 'preset-review-request-col',
                contents: [{
                    id: 'preset-review-title',
                    type: 'text',
                    values: {
                        text: '<h3 style="margin:0;text-align:center;line-height:1.35;">How did we do?</h3>',
                        padding: '22px 24px 8px',
                    }
                }, {
                    id: 'preset-review-copy',
                    type: 'text',
                    values: {
                        text: '<p style="margin:0;text-align:center;line-height:1.6;">Your feedback helps others shop with confidence. Drop in your review link below.</p>',
                        padding: '0px 24px 12px',
                    }
                }, {
                    id: 'preset-review-button',
                    type: 'button',
                    values: {
                        text: 'Leave a Review',
                        href: '{{store_url}}',
                        align: 'center',
                        backgroundColor: '#1d4ed8',
                        borderRadius: '8px',
                        padding: '0px 24px 24px'
                    }
                }]
            }],
            values: { backgroundColor: '#ffffff', padding: '0px' }
        }
    },
    shippingUpdate: {
        label: 'Shipping Update',
        row: {
            id: 'preset-shipping-update',
            cells: [1],
            columns: [{
                id: 'preset-shipping-update-col',
                contents: [{
                    id: 'preset-shipping-title',
                    type: 'text',
                    values: {
                        text: '<h3 style="margin:0;line-height:1.35;">Shipping Update for Order {{order_id}}</h3>',
                        padding: '20px 24px 6px',
                    }
                }, {
                    id: 'preset-shipping-copy',
                    type: 'text',
                    values: {
                        text: '<p style="margin:0;line-height:1.6;">Your package is on the move. Add tracking details and delivery estimates here.</p>',
                        padding: '0px 24px 20px',
                    }
                }]
            }],
            values: { backgroundColor: '#f8fafc', padding: '0px' }
        }
    },
};

export const EmailDesignEditor: React.FC<Props> = ({ initialDesign, onSave, onCancel }) => {
    const emailEditorRef = useRef<EditorRef>(null);
    const autosaveTimeoutRef = useRef<number | null>(null);

    const { token, user } = useAuth();
    const { currentAccount } = useAccount();

    const primaryColor = currentAccount?.appearance?.primaryColor || '#1d4ed8';
    const logoUrl = currentAccount?.appearance?.logoUrl || '';
    const appName = currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store';

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [showRestoreDraft, setShowRestoreDraft] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    const [showTestEmailPanel, setShowTestEmailPanel] = useState(false);
    const [sendingTest, setSendingTest] = useState(false);
    const [testEmail, setTestEmail] = useState('');
    const [testStatus, setTestStatus] = useState<string | null>(null);
    const [recentRecipients, setRecentRecipients] = useState<string[]>([]);

    const [showPreviewPanel, setShowPreviewPanel] = useState(false);
    const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
    const [previewHtml, setPreviewHtml] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);

    const [showChecklistPanel, setShowChecklistPanel] = useState(false);
    const [checklistItems, setChecklistItems] = useState<PreflightIssue[]>([]);
    const [checklistLoading, setChecklistLoading] = useState(false);
    const groupedChecklistItems = groupPreflightIssues(checklistItems);

    const [showHistoryPanel, setShowHistoryPanel] = useState(false);
    const [snapshots, setSnapshots] = useState<DesignSnapshot[]>([]);

    const starterLayouts = useMemo((): Array<{ id: string; label: string; design: unknown }> => ([
        {
            id: 'promo',
            label: 'Promo Hero',
            design: {
                counters: { u_row: 4, u_column: 4, u_content_text: 4, u_content_button: 1, u_content_image: 1 },
                body: {
                    id: 'promo-body',
                    rows: [
                        {
                            id: 'brand-header-row',
                            cells: [1],
                            columns: [{
                                id: 'brand-header-col',
                                contents: logoUrl ? [{
                                    id: 'brand-logo-image',
                                    type: 'image',
                                    values: {
                                        src: { url: logoUrl },
                                        altText: `${appName} Logo`,
                                        align: 'center',
                                        width: '130px',
                                        padding: '20px 20px 8px'
                                    }
                                }] : [{
                                    id: 'brand-logo-fallback',
                                    type: 'text',
                                    values: {
                                        text: `<p style="text-align:center;margin:0;font-size:20px;"><strong>${appName}</strong></p>`,
                                        padding: '22px 20px 10px',
                                    }
                                }]
                            }],
                            values: { backgroundColor: '#ffffff', padding: '0px' }
                        },
                        {
                            id: 'hero-row',
                            cells: [1],
                            columns: [{
                                id: 'hero-col',
                                contents: [{
                                    id: 'hero-title',
                                    type: 'text',
                                    values: {
                                        text: '<h1 style="text-align:center;margin:0;line-height:1.25;">Your next order deserves something special</h1>',
                                        padding: '30px 20px 10px',
                                    }
                                }, {
                                    id: 'hero-copy',
                                    type: 'text',
                                    values: {
                                        text: '<p style="text-align:center;margin:0;line-height:1.6;">Give customers a clear offer and one strong action.</p>',
                                        padding: '6px 20px 14px',
                                    }
                                }, {
                                    id: 'hero-cta',
                                    type: 'button',
                                    values: {
                                        text: 'Shop Now',
                                        href: '{{store_url}}',
                                        align: 'center',
                                        backgroundColor: primaryColor,
                                        borderRadius: '8px',
                                        padding: '8px 20px 28px'
                                    }
                                }]
                            }],
                            values: { backgroundColor: '#eff6ff', padding: '0px' }
                        }
                    ],
                    values: {
                        backgroundColor: '#f8fafc',
                        contentWidth: '640px',
                        fontFamily: { label: 'Arial', value: 'arial,helvetica,sans-serif' }
                    }
                },
                schemaVersion: 10,
            }
        },
        {
            id: 'announcement',
            label: 'Clean Announcement',
            design: {
                counters: { u_row: 3, u_column: 3, u_content_text: 3, u_content_button: 1 },
                body: {
                    id: 'announce-body',
                    rows: [{
                        id: 'announce-top',
                        cells: [1],
                        columns: [{
                            id: 'announce-col',
                            contents: [{
                                id: 'announce-heading',
                                type: 'text',
                                values: {
                                    text: '<h2 style="text-align:left;margin:0;line-height:1.3;">A quick update for {{contact_first_name}}</h2>',
                                    padding: '28px 20px 8px'
                                }
                            }, {
                                id: 'announce-copy',
                                type: 'text',
                                values: {
                                    text: '<p style="margin:0;line-height:1.65;">Use this for short updates, release notes, or inventory alerts. Keep sections tight for mobile.</p>',
                                    padding: '0px 20px 16px'
                                }
                            }, {
                                id: 'announce-cta',
                                type: 'button',
                                values: {
                                    text: 'View Details',
                                    href: '{{store_url}}',
                                    align: 'left',
                                    backgroundColor: primaryColor,
                                    borderRadius: '8px',
                                    padding: '0px 20px 24px'
                                }
                            }]
                        }],
                        values: { backgroundColor: '#ffffff', padding: '0px' }
                    }],
                    values: {
                        backgroundColor: '#f1f5f9',
                        contentWidth: '640px',
                        fontFamily: { label: 'Arial', value: 'arial,helvetica,sans-serif' }
                    }
                },
                schemaVersion: 10,
            }
        }
    ]), [appName, logoUrl, primaryColor]);

    const clearAutosaveTimeout = () => {
        if (autosaveTimeoutRef.current) {
            window.clearTimeout(autosaveTimeoutRef.current);
            autosaveTimeoutRef.current = null;
        }
    };

    const updateSnapshotsState = useCallback(() => {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) {
            setSnapshots([]);
            return;
        }
        try {
            const parsed = JSON.parse(raw) as DesignSnapshot[];
            setSnapshots(Array.isArray(parsed) ? parsed : []);
        } catch {
            setSnapshots([]);
        }
    }, []);

    const saveDesignSnapshot = useCallback((design: unknown) => {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        let existing: DesignSnapshot[] = [];
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as DesignSnapshot[];
                existing = Array.isArray(parsed) ? parsed : [];
            } catch {
                existing = [];
            }
        }

        const next: DesignSnapshot[] = [{
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            design,
        }, ...existing].slice(0, MAX_HISTORY_SNAPSHOTS);

        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
        setSnapshots(next);
    }, []);

    const saveDraftToLocalStorage = useCallback(() => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        editor.saveDesign((design: unknown) => {
            localStorage.setItem(
                DRAFT_STORAGE_KEY,
                JSON.stringify({
                    design,
                    updatedAt: new Date().toISOString(),
                })
            );
            saveDesignSnapshot(design);
        });
    }, [saveDesignSnapshot]);

    const queueDraftSave = useCallback(() => {
        clearAutosaveTimeout();
        autosaveTimeoutRef.current = window.setTimeout(() => {
            saveDraftToLocalStorage();
        }, 1200);
    }, [saveDraftToLocalStorage]);

    const exportHtml = useCallback(() => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        setSaving(true);
        editor.exportHtml((data) => {
            const { design, html } = data;
            onSave(html, design);
            saveDesignSnapshot(design);
            setHasUnsavedChanges(false);
            setLastSavedAt(new Date());
            localStorage.removeItem(DRAFT_STORAGE_KEY);
            setSaving(false);
        });
    }, [onSave, saveDesignSnapshot]);

    const runPreflightChecklist = useCallback(() => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        setChecklistLoading(true);
        setShowChecklistPanel(true);
        editor.exportHtml((data) => {
            setChecklistItems(evaluateEmailPreflight({
                html: data.html,
                subject: 'Email Builder Test',
                emailCategory: 'MARKETING',
            }));
            setChecklistLoading(false);
        });
    }, []);

    const refreshPreview = useCallback(() => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        setPreviewLoading(true);
        editor.exportHtml((data) => {
            setPreviewHtml(data.html || '');
            setPreviewLoading(false);
        });
    }, []);

    const appendPresetRow = (presetKey: keyof typeof PRESET_ROWS) => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        editor.saveDesign((design: unknown) => {
            const mutable = typeof structuredClone === 'function'
                ? structuredClone(design)
                : JSON.parse(JSON.stringify(design));

            const body = (mutable as { body?: { rows?: unknown[] } }).body;
            if (!body) return;
            if (!Array.isArray(body.rows)) {
                body.rows = [];
            }

            const preset = PRESET_ROWS[presetKey];
            const row = typeof structuredClone === 'function'
                ? structuredClone(preset.row)
                : JSON.parse(JSON.stringify(preset.row));
            body.rows.push(row);

            type LoadDesignArg = Parameters<typeof editor.loadDesign>[0];
            editor.loadDesign(mutable as LoadDesignArg);
            setHasUnsavedChanges(true);
            setTimeout(() => saveDraftToLocalStorage(), 200);
        });
    };

    const onReady = () => {
        setLoading(false);

        const editor = emailEditorRef.current?.editor;
        if (editor) {
            registerWooCommerceTools(editor);
            editor.setMergeTags(getWooCommerceMergeTags());
            editor.addEventListener('design:updated', () => {
                setHasUnsavedChanges(true);
                queueDraftSave();
            });
        }

        if (initialDesign && emailEditorRef.current?.editor) {
            const readyEditor = emailEditorRef.current.editor;
            type LoadDesignArg = Parameters<typeof readyEditor.loadDesign>[0];
            readyEditor.loadDesign(initialDesign as LoadDesignArg);
        } else if (!localStorage.getItem(DRAFT_STORAGE_KEY) && emailEditorRef.current?.editor) {
            const readyEditor = emailEditorRef.current.editor;
            type LoadDesignArg = Parameters<typeof readyEditor.loadDesign>[0];
            readyEditor.loadDesign(starterLayouts[0].design as LoadDesignArg);
            setHasUnsavedChanges(true);
        }
    };

    const restoreDraft = () => {
        const editor = emailEditorRef.current?.editor;
        const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!editor || !draft) return;

        try {
            const parsed = JSON.parse(draft) as { design?: unknown };
            if (parsed.design) {
                type LoadDesignArg = Parameters<typeof editor.loadDesign>[0];
                editor.loadDesign(parsed.design as LoadDesignArg);
                setHasUnsavedChanges(true);
            }
        } catch {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
        } finally {
            setShowRestoreDraft(false);
        }
    };

    const restoreSnapshot = (snapshot: DesignSnapshot) => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        type LoadDesignArg = Parameters<typeof editor.loadDesign>[0];
        editor.loadDesign(snapshot.design as LoadDesignArg);
        setHasUnsavedChanges(true);
        setShowHistoryPanel(false);
        setTimeout(() => saveDraftToLocalStorage(), 200);
    };

    const applyStarterLayout = (layoutId: string) => {
        const editor = emailEditorRef.current?.editor;
        const selectedLayout = starterLayouts.find((layout) => layout.id === layoutId);
        if (!editor || !selectedLayout) return;

        if (hasUnsavedChanges && !window.confirm('Replace current design with a starter layout? Unsaved changes will be overwritten.')) {
            return;
        }

        type LoadDesignArg = Parameters<typeof editor.loadDesign>[0];
        editor.loadDesign(selectedLayout.design as LoadDesignArg);
        setHasUnsavedChanges(true);
        setTimeout(() => saveDraftToLocalStorage(), 200);
    };

    const saveRecentRecipient = (recipient: string) => {
        const normalized = recipient.trim().toLowerCase();
        if (!normalized) return;
        const next = [normalized, ...recentRecipients.filter((item) => item !== normalized)].slice(0, MAX_TEST_RECIPIENTS);
        setRecentRecipients(next);
        localStorage.setItem(RECENT_TEST_RECIPIENTS_KEY, JSON.stringify(next));
    };

    const sendTestEmail = async (targetEmail?: string) => {
        const recipient = (targetEmail || testEmail).trim();
        if (!recipient || !recipient.includes('@')) {
            setTestStatus('Enter a valid email address first.');
            return;
        }

        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        setSendingTest(true);
        setTestStatus(null);

        editor.exportHtml(async (data) => {
            try {
                const res = await fetch('/api/marketing/test-email', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        'x-account-id': currentAccount?.id || ''
                    },
                    body: JSON.stringify({
                        to: recipient,
                        subject: 'Email Builder Test',
                        content: data.html
                    })
                });

                if (res.ok) {
                    saveRecentRecipient(recipient);
                    setTestStatus(`Test email sent to ${recipient}.`);
                } else {
                    const payload = await res.json();
                    setTestStatus(payload?.error || payload?.message || 'Failed to send test email.');
                }
            } catch {
                setTestStatus('Failed to send test email.');
            } finally {
                setSendingTest(false);
            }
        });
    };

    const handleCancel = () => {
        if (hasUnsavedChanges && !window.confirm('You have unsaved changes. Close without saving?')) {
            return;
        }
        onCancel();
    };

    useEffect(() => {
        const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (draft) {
            setShowRestoreDraft(true);
        }
        const recipientRaw = localStorage.getItem(RECENT_TEST_RECIPIENTS_KEY);
        if (recipientRaw) {
            try {
                const parsed = JSON.parse(recipientRaw) as string[];
                if (Array.isArray(parsed)) {
                    setRecentRecipients(parsed.slice(0, MAX_TEST_RECIPIENTS));
                }
            } catch {
                setRecentRecipients([]);
            }
        }
        if (user?.email) {
            setTestEmail(user.email);
        }
        updateSnapshotsState();

        return () => {
            clearAutosaveTimeout();
        };
    }, [updateSnapshotsState, user?.email]);

    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!hasUnsavedChanges) return;
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [hasUnsavedChanges]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (!loading && !saving) exportHtml();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [exportHtml, loading, saving]);

    const previewWidthClass = previewDevice === 'desktop'
        ? 'w-full max-w-[920px]'
        : previewDevice === 'tablet'
            ? 'w-full max-w-[768px]'
            : 'w-full max-w-[390px]';

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/50 backdrop-blur-xs">
            <div className="flex h-full w-full flex-col overflow-hidden bg-white">
                <div className="flex items-center justify-between bg-linear-to-r from-blue-600 to-indigo-600 px-4 py-3 text-white md:px-6 md:py-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-white/20 p-2">
                            <Mail size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Email Designer</h2>
                            <p className="hidden text-xs text-blue-100 sm:block">Drag and drop, run checklist, preview by device, then test send.</p>
                        </div>
                    </div>

                    <div className="hidden items-center gap-2 lg:flex">
                        {starterLayouts.map((layout) => (
                            <button
                                key={layout.id}
                                onClick={() => applyStarterLayout(layout.id)}
                                className="rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
                            >
                                {layout.label}
                            </button>
                        ))}
                    </div>

                    <div className="hidden items-center gap-2 text-xs text-blue-100 md:flex">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${hasUnsavedChanges ? 'bg-amber-500/20 text-amber-50' : 'bg-emerald-500/20 text-emerald-100'}`}>
                            {hasUnsavedChanges ? <AlertTriangle size={12} /> : <Save size={12} />}
                            {hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
                        </span>
                        {lastSavedAt && <span>Last saved {lastSavedAt.toLocaleTimeString()}</span>}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                setShowPreviewPanel((value) => !value);
                                if (!showPreviewPanel) {
                                    refreshPreview();
                                }
                            }}
                            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                        >
                            Preview
                        </button>
                        <button
                            onClick={runPreflightChecklist}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                        >
                            <ClipboardList size={16} />
                            <span className="hidden sm:inline">Checklist</span>
                        </button>
                        <button
                            onClick={() => {
                                setShowHistoryPanel((value) => !value);
                                updateSnapshotsState();
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                        >
                            <History size={16} />
                            <span className="hidden sm:inline">History</span>
                        </button>
                        <button
                            onClick={() => setShowTestEmailPanel((value) => !value)}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                        >
                            <Send size={16} />
                            <span className="hidden sm:inline">Send Test</span>
                        </button>
                        <button
                            onClick={handleCancel}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                        >
                            <X size={16} />
                            <span className="hidden sm:inline">Cancel</span>
                        </button>
                        <button
                            onClick={exportHtml}
                            disabled={loading || saving}
                            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            <span className="hidden sm:inline">Save Design</span>
                        </button>
                    </div>
                </div>

                <div className="relative bg-gray-100" style={{ height: 'calc(100vh - 60px)' }}>
                    {showTestEmailPanel && (
                        <div className="absolute right-4 top-4 z-30 w-[340px] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                            <p className="text-sm font-semibold text-slate-900">Send a quick test</p>
                            <p className="mt-1 text-xs text-slate-500">Use "send to me" or a recent recipient.</p>
                            <input
                                type="email"
                                value={testEmail}
                                onChange={(event) => setTestEmail(event.target.value)}
                                placeholder="you@company.com"
                                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                                {user?.email && (
                                    <button
                                        onClick={() => sendTestEmail(user.email)}
                                        className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                    >
                                        Send to me
                                    </button>
                                )}
                                {recentRecipients.map((recipient) => (
                                    <button
                                        key={recipient}
                                        onClick={() => sendTestEmail(recipient)}
                                        className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                    >
                                        {recipient}
                                    </button>
                                ))}
                            </div>
                            {testStatus && (
                                <p className="mt-2 text-xs text-slate-600">{testStatus}</p>
                            )}
                            <button
                                onClick={() => sendTestEmail()}
                                disabled={sendingTest}
                                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {sendingTest ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                Send Test Email
                            </button>
                        </div>
                    )}

                    {showPreviewPanel && (
                        <div className="absolute left-4 top-4 z-30 w-[min(92vw,980px)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-900">Device Preview</p>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setPreviewDevice('desktop')} className={`rounded-md px-2 py-1 text-xs ${previewDevice === 'desktop' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}><Monitor size={12} className="inline mr-1" />Desktop</button>
                                    <button onClick={() => setPreviewDevice('tablet')} className={`rounded-md px-2 py-1 text-xs ${previewDevice === 'tablet' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}><Tablet size={12} className="inline mr-1" />Tablet</button>
                                    <button onClick={() => setPreviewDevice('mobile')} className={`rounded-md px-2 py-1 text-xs ${previewDevice === 'mobile' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}><Smartphone size={12} className="inline mr-1" />Mobile</button>
                                    <button onClick={refreshPreview} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">Refresh</button>
                                </div>
                            </div>
                            <div className="max-h-[62vh] overflow-auto rounded-lg border bg-slate-50 p-3">
                                {previewLoading ? (
                                    <div className="flex h-[300px] items-center justify-center text-sm text-slate-500">Rendering preview...</div>
                                ) : (
                                    <div className="mx-auto overflow-hidden rounded-lg border bg-white shadow-sm">
                                        <div className={`mx-auto ${previewWidthClass}`}>
                                            <iframe
                                                srcDoc={previewHtml}
                                                title="Device Preview"
                                                className="h-[540px] w-full"
                                                sandbox="allow-same-origin"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {showChecklistPanel && (
                        <div className="absolute left-4 top-4 z-30 w-[380px] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-semibold text-slate-900">Preflight Checklist</p>
                                <button onClick={() => setShowChecklistPanel(false)} className="rounded p-1 hover:bg-slate-100"><X size={14} /></button>
                            </div>
                            {checklistLoading ? (
                                <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={14} className="animate-spin" /> Running checks...</div>
                            ) : (
                                <div className="space-y-2">
                                    {checklistItems.length === 0 && (
                                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                            No issues found. This email looks ready to test.
                                        </div>
                                    )}
                                    {groupedChecklistItems.blocking.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Blocking issues</p>
                                            {groupedChecklistItems.blocking.map((item) => (
                                                <div key={item.id} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                                    {item.message}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {groupedChecklistItems.warning.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Warnings</p>
                                            {groupedChecklistItems.warning.map((item) => (
                                                <div key={item.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                                    {item.message}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {showHistoryPanel && (
                        <div className="absolute left-4 top-4 z-30 w-[360px] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-semibold text-slate-900">Version History</p>
                                <button onClick={() => setShowHistoryPanel(false)} className="rounded p-1 hover:bg-slate-100"><X size={14} /></button>
                            </div>
                            <div className="max-h-[360px] space-y-2 overflow-auto">
                                {snapshots.length === 0 ? (
                                    <p className="text-xs text-slate-500">No snapshots yet. Start editing to create history.</p>
                                ) : snapshots.map((snapshot) => (
                                    <button
                                        key={snapshot.id}
                                        onClick={() => restoreSnapshot(snapshot)}
                                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50"
                                    >
                                        <span>{new Date(snapshot.createdAt).toLocaleString()}</span>
                                        <span className="text-blue-600">Restore</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {showRestoreDraft && (
                        <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg">
                            <div className="flex items-center gap-4 text-sm text-amber-900">
                                <span>Recovered unsaved draft found.</span>
                                <button onClick={restoreDraft} className="font-semibold hover:underline">Restore</button>
                                <button onClick={() => setShowRestoreDraft(false)} className="text-amber-700 hover:underline">Dismiss</button>
                                <Undo2 size={14} />
                            </div>
                        </div>
                    )}

                    <div className="absolute bottom-4 left-4 z-30 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                        <p className="mb-2 text-xs font-semibold text-slate-800">Quick Ecommerce Blocks</p>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(PRESET_ROWS).map(([key, value]) => (
                                <button
                                    key={key}
                                    onClick={() => appendPresetRow(key as keyof typeof PRESET_ROWS)}
                                    className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                    {value.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white">
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative">
                                    <div className="h-16 w-16 rounded-full border-4 border-blue-100" />
                                    <div className="absolute inset-0 h-16 w-16 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                                </div>
                                <div className="text-center">
                                    <p className="font-semibold text-gray-700">Loading Email Editor</p>
                                    <p className="mt-1 text-sm text-gray-400">Setting up your design tools...</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <EmailEditor
                        ref={emailEditorRef}
                        onLoad={() => {}}
                        onReady={onReady}
                        minHeight={'calc(100vh - 60px)'}
                        style={{
                            height: 'calc(100vh - 60px)',
                            width: '100%',
                            display: 'flex'
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
                            mergeTags: getWooCommerceMergeTags(),
                            displayMode: 'email',
                            tools: {
                                'custom#woo_product': { position: 1 },
                                'custom#woo_coupon': { position: 2 },
                                'custom#woo_address': { position: 3 },
                                'custom#woo_order_summary': { position: 4 },
                                'custom#woo_customer_notes': { position: 5 },
                                'custom#woo_order_downloads': { position: 6 },
                            },
                        }}
                    />
                </div>
            </div>
        </div>
    );
};
