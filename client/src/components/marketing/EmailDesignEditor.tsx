import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmailEditor, { EditorRef } from 'react-email-editor';
import {
    AlertTriangle,
    Bookmark,
    ClipboardList,
    History,
    Loader2,
    Mail,
    Save,
    Send,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import { getWooCommerceMergeTags, registerWooCommerceTools } from '../../lib/unlayerWooCommerceTools';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { evaluateEmailPreflight, groupPreflightIssues, type PreflightIssue } from '../../utils/emailPreflight';

interface Props {
    initialDesign?: unknown;
    onSave: (html: string, design: unknown) => void;
    onCancel: () => void;
}

interface DesignSnapshot {
    id: string;
    createdAt: string;
    design: unknown;
}

interface SavedRowPreset {
    id: string;
    name: string;
    row: Record<string, unknown>;
    createdAt: string;
    html?: string;
}

interface UnlayerBlockProviderEditor {
    registerProvider?: (type: 'blocks', provider: (params: unknown, done: (blocks: unknown[]) => void) => void) => void;
    reloadProvider?: (type: 'blocks') => void;
}

const DRAFT_STORAGE_KEY = 'overseek-email-builder-draft';
const HISTORY_STORAGE_KEY = 'overseek-email-builder-history';
const RECENT_TEST_RECIPIENTS_KEY = 'overseek-email-builder-recent-recipients';
const SAVED_HEADERS_KEY = 'overseek-email-builder-saved-headers';
const SAVED_FOOTERS_KEY = 'overseek-email-builder-saved-footers';
const MAX_HISTORY_SNAPSHOTS = 8;
const MAX_TEST_RECIPIENTS = 6;
const MAX_SAVED_SECTION_PRESETS = 12;

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

    const [showChecklistPanel, setShowChecklistPanel] = useState(false);
    const [checklistItems, setChecklistItems] = useState<PreflightIssue[]>([]);
    const [checklistLoading, setChecklistLoading] = useState(false);
    const groupedChecklistItems = groupPreflightIssues(checklistItems);

    const [showHistoryPanel, setShowHistoryPanel] = useState(false);
    const [showReusablePanel, setShowReusablePanel] = useState(false);
    const [snapshots, setSnapshots] = useState<DesignSnapshot[]>([]);
    const [savedHeaders, setSavedHeaders] = useState<SavedRowPreset[]>([]);
    const [savedFooters, setSavedFooters] = useState<SavedRowPreset[]>([]);

    const escapeHtml = (value: string) => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const rowToStaticHtml = useCallback((row: Record<string, unknown>): string => {
        const columns = Array.isArray((row as { columns?: unknown[] }).columns)
            ? ((row as { columns?: unknown[] }).columns as Record<string, unknown>[])
            : [];

        if (columns.length === 0) {
            return '<div style="background:#ffffff;padding:16px 20px;font-family:Arial,sans-serif;"><p style="margin:0;color:#64748b;">Saved block</p></div>';
        }

        const columnHtml = columns.map((column) => {
            const contents = Array.isArray((column as { contents?: unknown[] }).contents)
                ? ((column as { contents?: unknown[] }).contents as Record<string, unknown>[])
                : [];

            const contentHtml = contents.map((content) => {
                const type = (content as { type?: string }).type;
                const values = ((content as { values?: Record<string, unknown> }).values || {}) as Record<string, unknown>;

                if (type === 'text' && typeof values.text === 'string') {
                    return `<div style="margin:0;">${values.text}</div>`;
                }

                if (type === 'image') {
                    const src = (values.src as { url?: string } | undefined)?.url;
                    const alt = typeof values.altText === 'string' ? values.altText : 'Image';
                    if (src) {
                        return `<div style="text-align:center;"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border:0;" /></div>`;
                    }
                }

                if (type === 'button') {
                    const text = typeof values.text === 'string' ? values.text : 'Button';
                    const href = typeof values.href === 'string' ? values.href : '{{store_url}}';
                    return `<div style="text-align:center;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;">${escapeHtml(text)}</a></div>`;
                }

                if (type === 'divider') {
                    return '<hr style="border:0;border-top:1px solid #e2e8f0;margin:12px 0;" />';
                }

                return '';
            }).join('');

            return `<td style="vertical-align:top;padding:0 8px;">${contentHtml}</td>`;
        }).join('');

        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,sans-serif;background:#ffffff;"><tr>${columnHtml}</tr></table>`;
    }, []);

    const closeTransientPanels = useCallback(() => {
        setShowTestEmailPanel(false);
        setShowChecklistPanel(false);
        setShowHistoryPanel(false);
        setShowReusablePanel(false);
    }, []);

    const toggleTestPanel = useCallback(() => {
        setShowChecklistPanel(false);
        setShowHistoryPanel(false);
        setShowTestEmailPanel((value) => !value);
    }, []);

    const toggleChecklistPanel = useCallback(() => {
        setShowTestEmailPanel(false);
        setShowHistoryPanel(false);
        setShowChecklistPanel((value) => !value);
    }, []);

    const toggleHistoryPanel = useCallback(() => {
        setShowTestEmailPanel(false);
        setShowChecklistPanel(false);
        setShowReusablePanel(false);
        setShowHistoryPanel((value) => !value);
    }, []);

    const toggleReusablePanel = useCallback(() => {
        setShowTestEmailPanel(false);
        setShowChecklistPanel(false);
        setShowHistoryPanel(false);
        setShowReusablePanel((value) => !value);
    }, []);

    const defaultHeaderPresets = useMemo((): SavedRowPreset[] => ([
        {
            id: 'default-header-brand',
            name: 'Brand Header',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'default-header-brand-row',
                cells: [1],
                columns: [{
                    id: 'default-header-brand-col',
                    contents: logoUrl ? [{
                        id: 'default-header-brand-logo',
                        type: 'image',
                        values: {
                            src: { url: logoUrl },
                            altText: `${appName} Logo`,
                            align: 'center',
                            width: '140px',
                            padding: '20px 20px 8px'
                        }
                    }, {
                        id: 'default-header-brand-tagline',
                        type: 'text',
                        values: {
                            text: `<p style="text-align:center;margin:0;font-size:13px;color:#64748b;">${appName}</p>`,
                            padding: '0px 20px 16px'
                        }
                    }] : [{
                        id: 'default-header-brand-fallback',
                        type: 'text',
                        values: {
                            text: `<h2 style="text-align:center;margin:0;line-height:1.3;color:#0f172a;">${appName}</h2>`,
                            padding: '20px 20px 16px'
                        }
                    }]
                }],
                values: { backgroundColor: '#ffffff', padding: '0px' }
            }
        },
        {
            id: 'default-header-banner',
            name: 'Promo Banner Header',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'default-header-banner-row',
                cells: [1],
                columns: [{
                    id: 'default-header-banner-col',
                    contents: [{
                        id: 'default-header-banner-copy',
                        type: 'text',
                        values: {
                            text: '<p style="text-align:center;margin:0;font-size:13px;color:#ffffff;"><strong>Free shipping over $50</strong> &nbsp;|&nbsp; New arrivals every week</p>',
                            padding: '12px 16px'
                        }
                    }]
                }],
                values: { backgroundColor: primaryColor, padding: '0px' }
            }
        },
    ]), [appName, logoUrl, primaryColor]);

    const defaultFooterPresets = useMemo((): SavedRowPreset[] => ([
        {
            id: 'default-footer-simple',
            name: 'Simple Footer',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'default-footer-simple-row',
                cells: [1],
                columns: [{
                    id: 'default-footer-simple-col',
                    contents: [{
                        id: 'default-footer-simple-copy',
                        type: 'text',
                        values: {
                            text: `<p style="text-align:center;margin:0;font-size:12px;line-height:1.6;color:#64748b;">You are receiving this email from ${appName}.<br />{{store_url}}</p>`,
                            padding: '18px 20px 8px'
                        }
                    }, {
                        id: 'default-footer-simple-unsubscribe',
                        type: 'text',
                        values: {
                            text: '<p style="text-align:center;margin:0;font-size:12px;"><a href="{{unsubscribe_url}}" style="color:#64748b;">Unsubscribe</a></p>',
                            padding: '0px 20px 18px'
                        }
                    }]
                }],
                values: { backgroundColor: '#f8fafc', padding: '0px' }
            }
        },
        {
            id: 'default-footer-support',
            name: 'Support Footer',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'default-footer-support-row',
                cells: [1],
                columns: [{
                    id: 'default-footer-support-col',
                    contents: [{
                        id: 'default-footer-support-copy',
                        type: 'text',
                        values: {
                            text: '<p style="text-align:center;margin:0;font-size:12px;line-height:1.65;color:#475569;">Need help? Reply to this email and our team will assist you.<br />{{store_url}}</p>',
                            padding: '18px 20px'
                        }
                    }]
                }],
                values: { backgroundColor: '#e2e8f0', padding: '0px' }
            }
        },
    ]), [appName]);

    const textStylePresets = useMemo((): SavedRowPreset[] => ([
        {
            id: 'text-style-heading',
            name: 'Heading',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'text-style-heading-row',
                cells: [1],
                columns: [{
                    id: 'text-style-heading-col',
                    contents: [{
                        id: 'text-style-heading-content',
                        type: 'text',
                        values: {
                            text: '<h1 style="margin:0;line-height:1.25;text-align:left;">Add your main heading</h1>',
                            padding: '20px 20px 8px'
                        }
                    }]
                }],
                values: { backgroundColor: '#ffffff', padding: '0px' }
            }
        },
        {
            id: 'text-style-subheading',
            name: 'Subheading',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'text-style-subheading-row',
                cells: [1],
                columns: [{
                    id: 'text-style-subheading-col',
                    contents: [{
                        id: 'text-style-subheading-content',
                        type: 'text',
                        values: {
                            text: '<h2 style="margin:0;line-height:1.35;text-align:left;">Add a section heading</h2>',
                            padding: '16px 20px 8px'
                        }
                    }]
                }],
                values: { backgroundColor: '#ffffff', padding: '0px' }
            }
        },
        {
            id: 'text-style-body',
            name: 'Body Copy',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'text-style-body-row',
                cells: [1],
                columns: [{
                    id: 'text-style-body-col',
                    contents: [{
                        id: 'text-style-body-content',
                        type: 'text',
                        values: {
                            text: '<p style="margin:0;line-height:1.7;text-align:left;">Add your paragraph text here. Keep it concise and easy to scan on mobile.</p>',
                            padding: '0px 20px 12px'
                        }
                    }]
                }],
                values: { backgroundColor: '#ffffff', padding: '0px' }
            }
        },
        {
            id: 'text-style-bullet-list',
            name: 'Bullet List',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'text-style-list-row',
                cells: [1],
                columns: [{
                    id: 'text-style-list-col',
                    contents: [{
                        id: 'text-style-list-content',
                        type: 'text',
                        values: {
                            text: '<ul style="margin:0;padding-left:20px;line-height:1.7;"><li>First point</li><li>Second point</li><li>Third point</li></ul>',
                            padding: '0px 20px 16px'
                        }
                    }]
                }],
                values: { backgroundColor: '#ffffff', padding: '0px' }
            }
        },
        {
            id: 'text-style-highlight',
            name: 'Highlight Box',
            createdAt: new Date(0).toISOString(),
            row: {
                id: 'text-style-highlight-row',
                cells: [1],
                columns: [{
                    id: 'text-style-highlight-col',
                    contents: [{
                        id: 'text-style-highlight-content',
                        type: 'text',
                        values: {
                            text: '<p style="margin:0;line-height:1.6;text-align:left;"><strong>Tip:</strong> Add an important detail, warning, or deadline here.</p>',
                            padding: '14px 16px'
                        }
                    }]
                }],
                values: { backgroundColor: '#eff6ff', padding: '0px' }
            }
        }
    ]), []);

    const starterLayouts = useMemo((): Array<{ id: string; label: string; design: unknown }> => ([
        {
            id: 'promo',
            label: 'Promo Hero',
            design: {
                counters: { u_row: 5, u_column: 5, u_content_text: 5, u_content_button: 1, u_content_image: 1 },
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
                        },
                        {
                            id: 'promo-footer-row',
                            cells: [1],
                            columns: [{
                                id: 'promo-footer-col',
                                contents: [{
                                    id: 'promo-footer-copy',
                                    type: 'text',
                                    values: {
                                        text: `<p style="text-align:center;margin:0;font-size:12px;line-height:1.6;color:#64748b;">You are receiving this email from ${appName}.<br />{{store_url}}</p>`,
                                        padding: '18px 20px 8px'
                                    }
                                }, {
                                    id: 'promo-footer-unsubscribe',
                                    type: 'text',
                                    values: {
                                        text: '<p style="text-align:center;margin:0;font-size:12px;"><a href="{{unsubscribe_url}}" style="color:#64748b;">Unsubscribe</a></p>',
                                        padding: '0px 20px 18px'
                                    }
                                }]
                            }],
                            values: { backgroundColor: '#f8fafc', padding: '0px' }
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
                counters: { u_row: 5, u_column: 5, u_content_text: 5, u_content_button: 1, u_content_image: 1 },
                body: {
                    id: 'announce-body',
                    rows: [{
                        id: 'announce-header',
                        cells: [1],
                        columns: [{
                            id: 'announce-header-col',
                            contents: logoUrl ? [{
                                id: 'announce-logo-image',
                                type: 'image',
                                values: {
                                    src: { url: logoUrl },
                                    altText: `${appName} Logo`,
                                    align: 'left',
                                    width: '120px',
                                    padding: '20px 20px 8px'
                                }
                            }] : [{
                                id: 'announce-logo-fallback',
                                type: 'text',
                                values: {
                                    text: `<p style="margin:0;font-size:18px;"><strong>${appName}</strong></p>`,
                                    padding: '22px 20px 10px',
                                }
                            }]
                        }],
                        values: { backgroundColor: '#ffffff', padding: '0px' }
                    }, {
                        id: 'announce-top',
                        cells: [1],
                        columns: [{
                            id: 'announce-col',
                            contents: [{
                                id: 'announce-heading',
                                type: 'text',
                                values: {
                                    text: '<h2 style="text-align:left;margin:0;line-height:1.3;">A quick update for {{customer.firstName}}</h2>',
                                    padding: '16px 20px 8px'
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
                    }, {
                        id: 'announce-footer',
                        cells: [1],
                        columns: [{
                            id: 'announce-footer-col',
                            contents: [{
                                id: 'announce-footer-copy',
                                type: 'text',
                                values: {
                                    text: `<p style="text-align:left;margin:0;font-size:12px;line-height:1.6;color:#64748b;">You are receiving this email from ${appName}.<br />{{store_url}}</p>`,
                                    padding: '18px 20px 8px'
                                }
                            }, {
                                id: 'announce-footer-unsubscribe',
                                type: 'text',
                                values: {
                                    text: '<p style="margin:0;font-size:12px;"><a href="{{unsubscribe_url}}" style="color:#64748b;">Unsubscribe</a></p>',
                                    padding: '0px 20px 18px'
                                }
                            }]
                        }],
                        values: { backgroundColor: '#f8fafc', padding: '0px' }
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

    const createNativeBlock = useCallback((
        id: string,
        name: string,
        category: string,
        row: Record<string, unknown>,
        tags: string[] = []
    ) => ({
        id,
        name,
        category,
        tags,
        data: row,
    }), []);

    const buildNativeBlocks = useCallback((headers = savedHeaders, footers = savedFooters) => {
        const starterBlocks = starterLayouts.flatMap((layout) => {
            const rows = (layout.design as { body?: { rows?: Record<string, unknown>[] } }).body?.rows || [];
            return rows.map((row, index) => createNativeBlock(
                `${layout.id}-${index + 1}`,
                rows.length > 1 ? `${layout.label} ${index + 1}` : layout.label,
                'Starter Layouts',
                row,
                ['starter', 'layout']
            ));
        });

        return [
            ...textStylePresets.map((preset) => createNativeBlock(preset.id, preset.name, 'Text Block Styles', preset.row, ['text', 'style'])),
            ...starterBlocks,
            ...defaultHeaderPresets.map((preset) => createNativeBlock(preset.id, preset.name, 'Headers', preset.row, ['header'])),
            ...headers.map((preset) => createNativeBlock(preset.id, preset.name, 'Saved Headers', preset.row, ['header', 'saved'])),
            ...defaultFooterPresets.map((preset) => createNativeBlock(preset.id, preset.name, 'Footers', preset.row, ['footer'])),
            ...footers.map((preset) => createNativeBlock(preset.id, preset.name, 'Saved Footers', preset.row, ['footer', 'saved'])),
        ];
    }, [createNativeBlock, defaultFooterPresets, defaultHeaderPresets, savedFooters, savedHeaders, starterLayouts, textStylePresets]);

    const refreshNativeBlocks = useCallback(() => {
        const editor = emailEditorRef.current?.editor as (UnlayerBlockProviderEditor | undefined);
        if (typeof editor?.reloadProvider !== 'function') return;
        editor.reloadProvider('blocks');
    }, []);

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

        setShowTestEmailPanel(false);
        setShowHistoryPanel(false);
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


    const onReady = () => {
        setLoading(false);

        const editor = emailEditorRef.current?.editor;
        if (editor) {
            const blockEditor = editor as typeof editor & UnlayerBlockProviderEditor;
            if (typeof blockEditor.registerProvider === 'function') {
                blockEditor.registerProvider('blocks', (_params, done) => {
                    done(buildNativeBlocks(
                        loadSavedRows(SAVED_HEADERS_KEY),
                        loadSavedRows(SAVED_FOOTERS_KEY)
                    ));
                });
            }
            registerWooCommerceTools(editor as unknown as Parameters<typeof registerWooCommerceTools>[0]);
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

    const onLoad = () => {};

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

    const loadSavedRows = useCallback((key: string): SavedRowPreset[] => {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw) as SavedRowPreset[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }, []);

    const persistSavedRows = useCallback((key: string, rows: SavedRowPreset[]) => {
        localStorage.setItem(key, JSON.stringify(rows.slice(0, MAX_SAVED_SECTION_PRESETS)));
    }, []);

    const saveCurrentSection = (type: 'header' | 'footer') => {
        const editor = emailEditorRef.current?.editor;
        if (!editor) return;

        editor.saveDesign((design: unknown) => {
            const bodyRows = (design as { body?: { rows?: unknown[] } }).body?.rows;
            if (!Array.isArray(bodyRows) || bodyRows.length === 0) {
                window.alert('Add at least one row before saving a reusable section.');
                return;
            }

            const targetRow = type === 'header' ? bodyRows[0] : bodyRows[bodyRows.length - 1];
            const name = window.prompt(
                type === 'header' ? 'Name this reusable header:' : 'Name this reusable footer:',
                type === 'header' ? `Header ${savedHeaders.length + 1}` : `Footer ${savedFooters.length + 1}`
            );
            if (!name || !name.trim()) return;

            const rowCopy = typeof structuredClone === 'function'
                ? structuredClone(targetRow)
                : JSON.parse(JSON.stringify(targetRow));
            const nextItem: SavedRowPreset = {
                id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: name.trim(),
                row: rowCopy as Record<string, unknown>,
                createdAt: new Date().toISOString(),
                html: rowToStaticHtml(rowCopy as Record<string, unknown>),
            };

            if (type === 'header') {
                const next = [nextItem, ...savedHeaders].slice(0, MAX_SAVED_SECTION_PRESETS);
                setSavedHeaders(next);
                persistSavedRows(SAVED_HEADERS_KEY, next);
                refreshNativeBlocks();
            } else {
                const next = [nextItem, ...savedFooters].slice(0, MAX_SAVED_SECTION_PRESETS);
                setSavedFooters(next);
                persistSavedRows(SAVED_FOOTERS_KEY, next);
                refreshNativeBlocks();
            }
        });
    };

    const insertReusableSection = (preset: SavedRowPreset, type: 'header' | 'footer' | 'append') => {
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

            const rowCopy = typeof structuredClone === 'function'
                ? structuredClone(preset.row)
                : JSON.parse(JSON.stringify(preset.row));

            if (type === 'header') {
                body.rows.unshift(rowCopy);
            } else {
                body.rows.push(rowCopy);
            }

            type LoadDesignArg = Parameters<typeof editor.loadDesign>[0];
            editor.loadDesign(mutable as LoadDesignArg);
            setHasUnsavedChanges(true);
            setTimeout(() => saveDraftToLocalStorage(), 200);
        });
    };

    const deleteSavedSection = (id: string, type: 'header' | 'footer') => {
        if (type === 'header') {
            const next = savedHeaders.filter((item) => item.id !== id);
            setSavedHeaders(next);
            persistSavedRows(SAVED_HEADERS_KEY, next);
            refreshNativeBlocks();
            return;
        }
        const next = savedFooters.filter((item) => item.id !== id);
        setSavedFooters(next);
        persistSavedRows(SAVED_FOOTERS_KEY, next);
        refreshNativeBlocks();
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
        closeTransientPanels();
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
        setSavedHeaders(loadSavedRows(SAVED_HEADERS_KEY));
        setSavedFooters(loadSavedRows(SAVED_FOOTERS_KEY));
        if (user?.email) {
            setTestEmail(user.email);
        }
        updateSnapshotsState();

        return () => {
            clearAutosaveTimeout();
        };
    }, [loadSavedRows, updateSnapshotsState, user?.email]);

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

    const reusableSidebarContent = (
        <>
            <div className="mb-3">
                <div className="mb-2 flex items-center gap-2">
                    <Bookmark size={14} className="text-slate-600" />
                    <p className="text-xs font-semibold text-slate-800">Text Block Styles</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {textStylePresets.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => insertReusableSection(preset, 'append')}
                            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                        >
                            + {preset.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mb-2 border-t border-slate-200 pt-3" />

            <div className="mb-3">
                <div className="mb-2 flex items-center gap-2">
                    <Bookmark size={14} className="text-slate-600" />
                    <p className="text-xs font-semibold text-slate-800">Starter Layouts</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {starterLayouts.map((layout) => (
                        <button
                            key={layout.id}
                            onClick={() => applyStarterLayout(layout.id)}
                            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                        >
                            + {layout.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mb-2 border-t border-slate-200 pt-3">
                <div className="mb-2 flex items-center gap-2">
                    <Bookmark size={14} className="text-slate-600" />
                    <p className="text-xs font-semibold text-slate-800">Reusable Headers and Footers</p>
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Headers</p>
                <div className="flex flex-wrap gap-2">
                    {defaultHeaderPresets.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => insertReusableSection(preset, 'header')}
                            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                        >
                            + {preset.name}
                        </button>
                    ))}
                    <button
                        onClick={() => saveCurrentSection('header')}
                        className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
                    >
                        Save Top Row as Header
                    </button>
                </div>
                {savedHeaders.length > 0 && (
                    <div className="max-h-20 space-y-1 overflow-auto">
                        {savedHeaders.map((preset) => (
                            <div key={preset.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1">
                                <button onClick={() => insertReusableSection(preset, 'header')} className="truncate text-xs text-slate-700 hover:text-blue-700">Use {preset.name}</button>
                                <button onClick={() => deleteSavedSection(preset.id, 'header')} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 size={12} /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Footers</p>
                <div className="flex flex-wrap gap-2">
                    {defaultFooterPresets.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => insertReusableSection(preset, 'footer')}
                            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                        >
                            + {preset.name}
                        </button>
                    ))}
                    <button
                        onClick={() => saveCurrentSection('footer')}
                        className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
                    >
                        Save Bottom Row as Footer
                    </button>
                </div>
                {savedFooters.length > 0 && (
                    <div className="max-h-20 space-y-1 overflow-auto">
                        {savedFooters.map((preset) => (
                            <div key={preset.id} className="flex items-center justify-between rounded-md border border-slate-200 px-2 py-1">
                                <button onClick={() => insertReusableSection(preset, 'footer')} className="truncate text-xs text-slate-700 hover:text-blue-700">Use {preset.name}</button>
                                <button onClick={() => deleteSavedSection(preset.id, 'footer')} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 size={12} /></button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/45 backdrop-blur-sm">
            <div className="flex h-full w-full flex-col overflow-hidden rounded-none bg-slate-50">
                <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 text-slate-900 md:px-6 md:py-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-indigo-600">
                            <Mail size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">Email Designer</h2>
                            <p className="hidden text-xs text-slate-500 sm:block">Drag, style, run checks, then send a safe test.</p>
                        </div>
                    </div>

                    <div className="hidden items-center gap-2 text-xs text-slate-500 md:flex">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${hasUnsavedChanges ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {hasUnsavedChanges ? <AlertTriangle size={12} /> : <Save size={12} />}
                            {hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
                        </span>
                        {lastSavedAt && <span>Last saved {lastSavedAt.toLocaleTimeString()}</span>}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                            onClick={() => {
                                toggleChecklistPanel();
                                runPreflightChecklist();
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            <ClipboardList size={16} />
                            <span className="hidden sm:inline">Checklist</span>
                        </button>
                        <button
                            onClick={() => {
                                toggleHistoryPanel();
                                updateSnapshotsState();
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            <History size={16} />
                            <span className="hidden sm:inline">History</span>
                        </button>
                        <button
                            onClick={toggleReusablePanel}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            <Bookmark size={16} />
                            <span className="hidden sm:inline">Reusable</span>
                        </button>
                        <button
                            onClick={toggleTestPanel}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            <Send size={16} />
                            <span className="hidden sm:inline">Send Test</span>
                        </button>
                        <button
                            onClick={handleCancel}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            <X size={16} />
                            <span className="hidden sm:inline">Cancel</span>
                        </button>
                        <button
                            onClick={exportHtml}
                            disabled={loading || saving}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            <span className="hidden sm:inline">Save Design</span>
                        </button>
                    </div>

                    <div className="w-full border-t border-slate-200 pt-2 text-xs text-slate-500 md:hidden">
                        <div className="flex items-center justify-between gap-3">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                                {hasUnsavedChanges ? <AlertTriangle size={12} className="text-amber-600" /> : <Save size={12} className="text-emerald-600" />}
                                {hasUnsavedChanges ? 'Unsaved' : 'Saved'}
                            </span>
                            <span className="text-right">Tip: <kbd className="rounded border border-slate-300 bg-slate-50 px-1 py-0.5 font-mono">Ctrl/Cmd+S</kbd> to save</span>
                        </div>
                    </div>
                </div>

                <div className="relative bg-slate-100" style={{ height: 'calc(100vh - 82px)' }}>
                    {showTestEmailPanel && (
                        <div className="absolute left-2 right-2 top-2 z-30 w-auto rounded-xl border border-slate-200/80 bg-white/95 p-4 shadow-lg backdrop-blur-sm md:left-auto md:right-4 md:top-4 md:w-[340px]">
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

                    {showChecklistPanel && (
                        <div className="absolute left-2 right-2 top-2 z-30 w-auto rounded-xl border border-slate-200/80 bg-white/95 p-4 shadow-lg backdrop-blur-sm md:left-auto md:right-4 md:top-4 md:w-[380px]">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-semibold text-slate-900">Preflight Checklist</p>
                                <button onClick={closeTransientPanels} className="rounded p-1 hover:bg-slate-100"><X size={14} /></button>
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
                        <div className="absolute left-2 right-2 top-2 z-30 w-auto rounded-xl border border-slate-200/80 bg-white/95 p-4 shadow-lg backdrop-blur-sm md:left-auto md:right-4 md:top-4 md:w-[360px]">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-semibold text-slate-900">Version History</p>
                                <button onClick={closeTransientPanels} className="rounded p-1 hover:bg-slate-100"><X size={14} /></button>
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
                        <div className="absolute left-2 right-2 top-2 z-30 rounded-lg border border-amber-200 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur-sm md:left-1/2 md:right-auto md:top-4 md:-translate-x-1/2">
                            <div className="flex items-center gap-4 text-sm text-amber-900">
                                <span>Recovered unsaved draft found.</span>
                                <button onClick={restoreDraft} className="font-semibold hover:underline">Restore</button>
                                <button onClick={() => setShowRestoreDraft(false)} className="text-amber-700 hover:underline">Dismiss</button>
                                <Undo2 size={14} />
                            </div>
                        </div>
                    )}

                    {showReusablePanel && (
                        <div className="absolute left-2 right-2 top-2 z-30 max-h-[70vh] overflow-auto rounded-xl border border-slate-200/80 bg-white/95 p-3 shadow-lg backdrop-blur-sm md:left-auto md:right-4 md:top-4 md:max-h-[78vh] md:w-[360px]">
                            <div className="mb-2 flex items-center justify-between">
                                <p className="text-sm font-semibold text-slate-900">Reusable Blocks</p>
                                <button onClick={() => setShowReusablePanel(false)} className="rounded p-1 hover:bg-slate-100"><X size={14} /></button>
                            </div>
                            {reusableSidebarContent}
                        </div>
                    )}

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

                    <div className="h-full">
                        <EmailEditor
                            ref={emailEditorRef}
                            onLoad={onLoad}
                            onReady={onReady}
                            minHeight={'calc(100vh - 82px)'}
                            style={{
                                height: 'calc(100vh - 82px)',
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
                                preview: {
                                    enabled: true,
                                    deviceResolutions: {
                                        showDefaultResolutions: true,
                                    },
                                },
                                textEditor: {
                                    spellChecker: true
                                }
                            },
                            mergeTags: getWooCommerceMergeTags(),
                            displayMode: 'email',
                            tools: {
                                heading: { enabled: false },
                                paragraph: { enabled: false },
                                text: { position: 1 },
                                'custom#woo_product': { position: 2 },
                                'custom#woo_coupon': { position: 3 },
                                'custom#woo_address': { position: 4 },
                                'custom#woo_order_summary': { position: 5 },
                                'custom#woo_customer_notes': { position: 6 },
                                'custom#woo_order_downloads': { position: 7 },
                                'custom#woo_section_product_spotlight': { position: 8 },
                                'custom#woo_section_coupon_strip': { position: 9 },
                                'custom#woo_section_review_request': { position: 10 },
                                'custom#woo_section_shipping_update': { position: 11 },
                                'custom#woo_text_heading': { position: 12 },
                                'custom#woo_text_subheading': { position: 13 },
                                'custom#woo_text_body_copy': { position: 14 },
                                'custom#woo_text_bullet_list': { position: 15 },
                                'custom#woo_text_highlight_box': { position: 16 },
                                'custom#woo_layout_promo_hero': { position: 17 },
                                'custom#woo_layout_clean_announcement': { position: 18 },
                                'custom#woo_header_brand': { position: 19 },
                                'custom#woo_header_promo_banner': { position: 20 },
                                'custom#woo_footer_simple': { position: 21 },
                                'custom#woo_footer_support': { position: 22 },
                            },
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
