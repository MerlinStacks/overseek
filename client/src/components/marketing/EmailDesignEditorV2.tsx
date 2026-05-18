import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { AlertTriangle, Box, CheckCircle, ClipboardList, Code2, Columns2, Copy, Eye, Globe2, GripVertical, History, ImageIcon, Layers, List, Loader2, Menu, Minus, Monitor, PanelTop, Pencil, Plus, RectangleHorizontal, Save, Search, Send, Settings, Share2, Smartphone, Ticket, Trash2, Type, X } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { evaluateEmailPreflight, groupPreflightIssues, type PreflightIssue } from '../../utils/emailPreflight';
import {
    compileEmailDesignV2,
    createEmailDesignV2FromUnknown,
    createEmailDesignId,
    getEmailDesignV2BlockLabel,
    type EmailBlock,
    type EmailDesignV2Envelope,
    type EmailDeviceVisibility,
    type EmailSection,
    type EmailStackMode,
} from '../../lib/emailDesignerV2';

interface Props {
    initialDesign?: unknown;
    initialSubject?: string;
    initialPreviewText?: string;
    onSave: (html: string, design: unknown, meta?: { subject: string; previewText: string }) => void;
    onCancel: () => void;
}

interface Snapshot {
    id: string;
    createdAt: string;
    design: EmailDesignV2Envelope;
}

const DRAFT_STORAGE_KEY = 'overseek-email-builder-v2-draft';
const HISTORY_STORAGE_KEY = 'overseek-email-builder-v2-history';
const MAX_HISTORY = 12;

type Panel = 'blocks' | 'settings' | 'checklist' | 'history' | 'test';
type BuilderTab = 'structure' | 'blocks' | 'layouts' | 'global';
type PaletteKey = 'siteLogo' | 'text' | 'list' | 'button' | 'image' | 'divider' | 'menu' | 'social' | 'rawHtml' | 'footer' | 'product' | 'coupon';

interface PaletteItem {
    key: PaletteKey;
    label: string;
    group: 'General' | 'WooCommerce';
    icon: typeof Type;
}

const cloneDesign = (design: EmailDesignV2Envelope): EmailDesignV2Envelope => (
    typeof structuredClone === 'function' ? structuredClone(design) : JSON.parse(JSON.stringify(design))
);

const createBlock = (type: EmailBlock['type']): EmailBlock => {
    const id = createEmailDesignId(type);
    if (type === 'text') return { id, type, props: { html: '<p>Add your copy here.</p>', align: 'left', size: 15, lineHeight: 1.6 } };
    if (type === 'image') return { id, type, props: { src: 'https://via.placeholder.com/560x260?text=Image', alt: 'Email image', width: 560, align: 'center' } };
    if (type === 'button') return { id, type, props: { label: 'Shop Now', href: '{{store_url}}', align: 'center' } };
    if (type === 'divider') return { id, type, props: { color: '#e2e8f0', padding: '16px 0' } };
    if (type === 'spacer') return { id, type, props: { height: 24 } };
    if (type === 'product') return { id, type, props: { showImage: true, showDescription: true, showPrice: true, buttonLabel: 'View Product', buttonHref: '{{store_url}}' } };
    if (type === 'orderSummary') return { id, type, props: { heading: 'Order summary', showTotals: true } };
    if (type === 'address') return { id, type, props: { title: 'Shipping address', source: 'shipping' } };
    if (type === 'coupon') return { id, type, props: { headline: 'Your exclusive offer', code: '{{coupon.code}}', description: '{{coupon.description}}' } };
    return { id, type: 'rawHtml', props: { html: '<div style="padding:16px;">Custom HTML</div>' } };
};

const createPaletteBlock = (key: PaletteKey, accountName: string, logoUrl = ''): EmailBlock => {
    if (key === 'siteLogo') {
        if (logoUrl) return { id: createEmailDesignId('image'), type: 'image', props: { src: logoUrl, alt: `${accountName} logo`, width: 160, align: 'center' } };
        return { id: createEmailDesignId('text'), type: 'text', props: { html: `<h1>${accountName}</h1>`, align: 'center', size: 28, lineHeight: 1.25 } };
    }
    if (key === 'list') return { id: createEmailDesignId('text'), type: 'text', props: { html: '<ul><li>First benefit</li><li>Second benefit</li><li>Third benefit</li></ul>', align: 'left', size: 15, lineHeight: 1.6 } };
    if (key === 'menu') return { id: createEmailDesignId('rawHtml'), type: 'rawHtml', props: { html: '<div style="text-align:center;padding:8px 0;"><a href="{{store_url}}" style="margin:0 10px;color:#4f46e5;text-decoration:none;">Shop</a><a href="{{store_url}}/account" style="margin:0 10px;color:#4f46e5;text-decoration:none;">Account</a></div>' } };
    if (key === 'social') return { id: createEmailDesignId('rawHtml'), type: 'rawHtml', props: { html: '<div style="text-align:center;padding:8px 0;"><a href="#" style="margin:0 8px;color:#4f46e5;text-decoration:none;">Facebook</a><a href="#" style="margin:0 8px;color:#4f46e5;text-decoration:none;">Instagram</a></div>' } };
    if (key === 'footer') return { id: createEmailDesignId('text'), type: 'text', props: { html: `<p>You are receiving this email from ${accountName}.<br /><a href="{{unsubscribe_url}}">Unsubscribe</a></p>`, align: 'center', size: 12, color: '#64748b', lineHeight: 1.6 } };
    if (key === 'rawHtml') return createBlock('rawHtml');
    return createBlock(key);
};

const paletteItems: PaletteItem[] = [
    { key: 'siteLogo', label: 'Site Logo', group: 'General', icon: PanelTop },
    { key: 'text', label: 'Text', group: 'General', icon: Type },
    { key: 'list', label: 'List', group: 'General', icon: List },
    { key: 'button', label: 'Button', group: 'General', icon: RectangleHorizontal },
    { key: 'image', label: 'Image', group: 'General', icon: ImageIcon },
    { key: 'divider', label: 'Divider', group: 'General', icon: Minus },
    { key: 'menu', label: 'Menu', group: 'General', icon: Menu },
    { key: 'social', label: 'Social', group: 'General', icon: Share2 },
    { key: 'rawHtml', label: 'HTML', group: 'General', icon: Code2 },
    { key: 'footer', label: 'Footer', group: 'General', icon: Smartphone },
    { key: 'product', label: 'Product', group: 'WooCommerce', icon: Box },
    { key: 'coupon', label: 'Coupon', group: 'WooCommerce', icon: Ticket },
];

const RECENT_TEST_RECIPIENTS_KEY = 'overseek-email-builder-v2-test-recipients';
const MAX_TEST_RECIPIENTS = 5;

export function EmailDesignEditorV2({ initialDesign, initialSubject = '', initialPreviewText = '', onSave, onCancel }: Props) {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const [design, setDesign] = useState<EmailDesignV2Envelope>(() => {
        return createEmailDesignV2FromUnknown(initialDesign, {
            title: initialSubject,
            previewText: initialPreviewText,
            appName: currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store',
            logoUrl: currentAccount?.appearance?.logoUrl || '',
            primaryColor: currentAccount?.appearance?.primaryColor || '#4f46e5',
        });
    });
    const [selectedSectionId, setSelectedSectionId] = useState(() => design.document.sections[0]?.id || '');
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [activePanel, setActivePanel] = useState<Panel>('blocks');
    const [builderTab, setBuilderTab] = useState<BuilderTab>('blocks');
    const [blockSearch, setBlockSearch] = useState('');
    const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
    const [saving, setSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [issues, setIssues] = useState<PreflightIssue[]>([]);
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [testEmail, setTestEmail] = useState(user?.email || '');
    const [testStatus, setTestStatus] = useState<string | null>(null);
    const [sendingTest, setSendingTest] = useState(false);
    const [recentRecipients, setRecentRecipients] = useState<string[]>([]);
    const [missingEmailAccount, setMissingEmailAccount] = useState(false);

    const html = useMemo(() => compileEmailDesignV2(design), [design]);
    const selectedSection = design.document.sections.find((section) => section.id === selectedSectionId) || design.document.sections[0];
    const selectedBlock = selectedSection?.columns.flatMap((column) => column.blocks).find((block) => block.id === selectedBlockId) || null;
    const groupedIssues = groupPreflightIssues(issues);
    const visiblePaletteItems = paletteItems.filter((item) => item.label.toLowerCase().includes(blockSearch.trim().toLowerCase()));
    const saveStatus = saving ? 'Saving...' : hasUnsavedChanges ? 'Autosaved draft' : lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : 'Ready';

    const setDirtyDesign = useCallback((updater: (draft: EmailDesignV2Envelope) => void) => {
        setDesign((current) => {
            const next = cloneDesign(current);
            updater(next);
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ design: next, updatedAt: new Date().toISOString() }));
            setHasUnsavedChanges(true);
            return next;
        });
    }, []);

    const saveSnapshot = useCallback((nextDesign: EmailDesignV2Envelope) => {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        let current: Snapshot[] = [];
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Snapshot[];
                current = Array.isArray(parsed) ? parsed : [];
            } catch {
                current = [];
            }
        }
        const next = [{ id: createEmailDesignId('snapshot'), createdAt: new Date().toISOString(), design: nextDesign }, ...current].slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
        setSnapshots(next);
    }, []);

    const addSection = (columns = 1) => {
        setDirtyDesign((draft) => {
            const section: EmailSection = {
                id: createEmailDesignId('section'),
                name: columns === 1 ? 'New section' : 'Two-column section',
                backgroundColor: draft.document.theme.contentBackgroundColor,
                padding: '22px 28px',
                visibility: 'all',
                stackMode: 'stack',
                columns: Array.from({ length: columns }, () => ({
                    id: createEmailDesignId('column'),
                    width: Math.floor(100 / columns),
                    blocks: [],
                })),
            };
            draft.document.sections.push(section);
            setSelectedSectionId(section.id);
            setSelectedBlockId(null);
        });
    };

    const addPaletteBlock = (sectionId: string, key: PaletteKey, insertIndex?: number) => {
        const accountName = currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store';
        const logoUrl = currentAccount?.appearance?.logoUrl || '';
        const block = createPaletteBlock(key, accountName, logoUrl);
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === sectionId);
            const blocks = section?.columns[0]?.blocks;
            if (!blocks) return;
            if (typeof insertIndex === 'number') blocks.splice(insertIndex, 0, block);
            else blocks.push(block);
            setSelectedSectionId(sectionId);
            setSelectedBlockId(block.id);
        });
    };

    const moveBlock = (blockId: string, targetSectionId: string, targetIndex?: number) => {
        setDirtyDesign((draft) => {
            let movingBlock: EmailBlock | null = null;
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const currentIndex = column.blocks.findIndex((block) => block.id === blockId);
                    if (currentIndex >= 0) {
                        [movingBlock] = column.blocks.splice(currentIndex, 1);
                    }
                }
            }
            if (!movingBlock) return;
            const targetSection = draft.document.sections.find((section) => section.id === targetSectionId);
            const blocks = targetSection?.columns[0]?.blocks;
            if (!blocks) return;
            const nextIndex = typeof targetIndex === 'number' ? Math.min(targetIndex, blocks.length) : blocks.length;
            blocks.splice(nextIndex, 0, movingBlock);
            setSelectedSectionId(targetSectionId);
            setSelectedBlockId(blockId);
        });
    };

    const handleDropOnSection = (event: DragEvent, sectionId: string, insertIndex?: number) => {
        event.preventDefault();
        const paletteKey = event.dataTransfer.getData('application/x-overseek-block') as PaletteKey;
        const blockId = event.dataTransfer.getData('application/x-overseek-existing-block');
        if (paletteKey) addPaletteBlock(sectionId, paletteKey, insertIndex);
        else if (blockId) moveBlock(blockId, sectionId, insertIndex);
    };

    const updateSection = (key: keyof EmailSection, value: string) => {
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === selectedSectionId);
            if (!section) return;
            if (key === 'visibility') section.visibility = value as EmailDeviceVisibility;
            else if (key === 'stackMode') section.stackMode = value as EmailStackMode;
            else if (key === 'name' || key === 'backgroundColor' || key === 'padding') section[key] = value;
        });
    };

    const updateBlock = (updater: (block: EmailBlock) => void) => {
        if (!selectedBlockId) return;
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const block = column.blocks.find((item) => item.id === selectedBlockId);
                    if (block) updater(block);
                }
            }
        });
    };

    const updateBlockById = (blockId: string, updater: (block: EmailBlock) => void) => {
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const block = column.blocks.find((item) => item.id === blockId);
                    if (block) updater(block);
                }
            }
        });
    };

    const updateTheme = (key: keyof EmailDesignV2Envelope['document']['theme'], value: string | number) => {
        setDirtyDesign((draft) => {
            Object.assign(draft.document.theme, { [key]: value });
        });
    };

    const duplicateBlock = (blockId: string) => {
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    const index = column.blocks.findIndex((item) => item.id === blockId);
                    if (index < 0) continue;
                    const duplicated = typeof structuredClone === 'function' ? structuredClone(column.blocks[index]) : JSON.parse(JSON.stringify(column.blocks[index]));
                    duplicated.id = createEmailDesignId(duplicated.type);
                    column.blocks.splice(index + 1, 0, duplicated);
                    setSelectedSectionId(section.id);
                    setSelectedBlockId(duplicated.id);
                    return;
                }
            }
        });
    };

    const deleteBlockById = (blockId: string) => {
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    column.blocks = column.blocks.filter((block) => block.id !== blockId);
                }
            }
            if (selectedBlockId === blockId) setSelectedBlockId(null);
        });
    };

    const deleteSelectedBlock = () => {
        if (!selectedBlockId) return;
        setDirtyDesign((draft) => {
            for (const section of draft.document.sections) {
                for (const column of section.columns) {
                    column.blocks = column.blocks.filter((block) => block.id !== selectedBlockId);
                }
            }
            setSelectedBlockId(null);
        });
    };

    const deleteSelectedSection = () => {
        if (!selectedSection || design.document.sections.length <= 1) return;
        setDirtyDesign((draft) => {
            draft.document.sections = draft.document.sections.filter((section) => section.id !== selectedSection.id);
            setSelectedSectionId(draft.document.sections[0]?.id || '');
            setSelectedBlockId(null);
        });
    };

    const applyStarterLayout = (type: 'promo' | 'product' | 'cart' | 'followup' | 'coupon') => {
        const accountName = currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store';
        const logoUrl = currentAccount?.appearance?.logoUrl || '';
        const heroCopy: Record<typeof type, string> = {
            promo: '<h2>Something new just landed</h2><p>Give customers a clear reason to click with a focused offer and one strong call to action.</p>',
            product: '<h2>Meet your next favourite product</h2><p>Showcase the item, explain the benefit, and send customers straight to the product page.</p>',
            cart: '<h2>You left something behind</h2><p>Your basket is still waiting. Complete checkout before your items sell out.</p>',
            followup: '<h2>Thanks for your order</h2><p>Here is everything you need to know about what happens next.</p>',
            coupon: '<h2>A little thank you</h2><p>Use this code on your next order before it expires.</p>',
        };
        setDirtyDesign((draft) => {
            draft.document.sections = [
                {
                    id: createEmailDesignId('section'),
                    name: 'Header',
                    backgroundColor: draft.document.theme.contentBackgroundColor,
                    padding: '24px 28px 12px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{ id: createEmailDesignId('column'), width: 100, blocks: [createPaletteBlock('siteLogo', accountName, logoUrl)] }],
                },
                {
                    id: createEmailDesignId('section'),
                    name: 'Main message',
                    backgroundColor: draft.document.theme.contentBackgroundColor,
                    padding: '18px 28px 28px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{
                        id: createEmailDesignId('column'),
                        width: 100,
                        blocks: [
                            { id: createEmailDesignId('text'), type: 'text', props: { html: heroCopy[type], align: 'center', size: 16, lineHeight: 1.65 } },
                            type === 'product' ? createBlock('product') : type === 'coupon' ? createBlock('coupon') : createBlock('button'),
                        ],
                    }],
                },
                {
                    id: createEmailDesignId('section'),
                    name: 'Footer',
                    backgroundColor: '#f8fafc',
                    padding: '18px 28px',
                    visibility: 'all',
                    stackMode: 'stack',
                    columns: [{ id: createEmailDesignId('column'), width: 100, blocks: [createPaletteBlock('footer', accountName)] }],
                },
            ];
            setSelectedSectionId(draft.document.sections[1]?.id || draft.document.sections[0]?.id || '');
            setSelectedBlockId(null);
        });
    };

    const runChecklist = () => {
        setIssues(evaluateEmailPreflight({ html, subject: design.document.meta.title, emailCategory: design.document.meta.category || 'MARKETING' }));
        setActivePanel('checklist');
    };

    const saveDesign = () => {
        setSaving(true);
        saveSnapshot(design);
        onSave(html, design, { subject: design.document.meta.title, previewText: design.document.meta.previewText || '' });
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        setHasUnsavedChanges(false);
        setLastSavedAt(new Date());
        setSaving(false);
    };

    const sendTestEmail = async () => {
        const recipient = testEmail.trim();
        if (!recipient || !recipient.includes('@') || !currentAccount) {
            setTestStatus('Enter a valid recipient first.');
            return;
        }
        setSendingTest(true);
        setTestStatus(null);
        setMissingEmailAccount(false);
        try {
            const response = await fetch('/api/marketing/test-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'x-account-id': currentAccount.id,
                },
                body: JSON.stringify({ to: recipient, subject: design.document.meta.title || 'Email Builder Test', content: html }),
            });
            if (!response.ok) {
                const payload = await response.json();
                const message = payload?.error || payload?.message || 'Failed to send test email.';
                const isMissingEmailAccount = message.includes('No email account configured') || message.includes('No sending-capable email account');
                setMissingEmailAccount(isMissingEmailAccount);
                setTestStatus(isMissingEmailAccount ? 'No sending email account is configured. Add one in Settings > Email before sending a test.' : message);
                return;
            }
            const nextRecipients = [recipient, ...recentRecipients.filter((item) => item !== recipient)].slice(0, MAX_TEST_RECIPIENTS);
            localStorage.setItem(RECENT_TEST_RECIPIENTS_KEY, JSON.stringify(nextRecipients));
            setRecentRecipients(nextRecipients);
            setTestStatus(`Test email sent to ${recipient}.`);
        } catch {
            setTestStatus('Failed to send test email.');
        } finally {
            setSendingTest(false);
        }
    };

    useEffect(() => {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Snapshot[];
                setSnapshots(Array.isArray(parsed) ? parsed : []);
            } catch {
                setSnapshots([]);
            }
        }
        const recipientRaw = localStorage.getItem(RECENT_TEST_RECIPIENTS_KEY);
        if (recipientRaw) {
            try {
                const parsed = JSON.parse(recipientRaw) as string[];
                setRecentRecipients(Array.isArray(parsed) ? parsed.slice(0, MAX_TEST_RECIPIENTS) : []);
            } catch {
                setRecentRecipients([]);
            }
        }
    }, []);

    useEffect(() => {
        const handler = (event: BeforeUnloadEvent) => {
            if (!hasUnsavedChanges) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/55 backdrop-blur-sm">
            <div className="flex h-full flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex min-w-[280px] flex-1 items-center gap-3 border-r border-slate-200 pr-4 dark:border-slate-800">
                        <div className="min-w-0 flex-1">
                            <input
                                value={design.document.meta.title}
                                onChange={(event) => setDirtyDesign((draft) => { draft.document.meta.title = event.target.value; })}
                                placeholder="Add a Subject Text"
                                className="block w-full border-0 bg-transparent p-0 text-base font-semibold text-slate-950 placeholder:text-slate-950 focus:ring-0 dark:text-white dark:placeholder:text-white"
                            />
                            <input
                                value={design.document.meta.previewText || ''}
                                onChange={(event) => setDirtyDesign((draft) => { draft.document.meta.previewText = event.target.value; })}
                                placeholder="Add a Preview Text"
                                className="mt-0.5 block w-full border-0 bg-transparent p-0 text-sm text-indigo-500 placeholder:text-indigo-500 focus:ring-0 dark:text-indigo-300"
                            />
                        </div>
                        <Pencil size={17} className="shrink-0 text-slate-500 dark:text-slate-400" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold md:inline-flex ${hasUnsavedChanges ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {saveStatus}
                        </span>
                        <button onClick={runChecklist} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><ClipboardList size={16} />Checklist</button>
                        <button onClick={() => setActivePanel('history')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><History size={16} />History</button>
                        <button onClick={() => setActivePanel('test')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><Send size={16} />Test</button>
                        <button onClick={onCancel} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><X size={16} />Close</button>
                        <button onClick={saveDesign} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}Save</button>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[324px_1fr_360px]">
                    <aside className="flex min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                        <div className="m-3 grid grid-cols-3 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
                            {(['structure', 'blocks', 'layouts'] as BuilderTab[]).map((tab) => (
                                <button key={tab} onClick={() => { setBuilderTab(tab); setActivePanel(tab === 'blocks' ? 'blocks' : 'settings'); }} className={`rounded-md px-3 py-2 capitalize transition ${builderTab === tab ? 'bg-white text-slate-950 shadow-md dark:bg-slate-950 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}>{tab}</button>
                            ))}
                        </div>

                        {builderTab === 'blocks' && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
                                <label className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950">
                                    <Search size={15} />
                                    <input value={blockSearch} onChange={(event) => setBlockSearch(event.target.value)} placeholder="Search blocks" className="w-full border-0 bg-transparent p-0 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-0 dark:text-slate-100" />
                                </label>
                                <div>
                                    <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">General</p>
                                    <PaletteGrid items={visiblePaletteItems.filter((item) => item.group === 'General')} onAdd={(key) => selectedSection && addPaletteBlock(selectedSection.id, key)} />
                                </div>
                                <div className="mt-6">
                                    <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">WooCommerce</p>
                                    <PaletteGrid items={visiblePaletteItems.filter((item) => item.group === 'WooCommerce')} onAdd={(key) => selectedSection && addPaletteBlock(selectedSection.id, key)} />
                                </div>
                            </div>
                        )}

                        {builderTab === 'structure' && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
                                <p className="mb-2 text-sm font-medium text-slate-950 dark:text-white">Structure</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => addSection(1)} className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"><Plus size={14} className="mx-auto mb-1" />One column</button>
                                    <button onClick={() => addSection(2)} className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"><Columns2 size={14} className="mx-auto mb-1" />Two column</button>
                                </div>
                                <p className="mb-2 mt-6 text-sm font-medium text-slate-950 dark:text-white">Starter layouts</p>
                                <div className="space-y-2">
                                    {([
                                        ['promo', 'Promo email'],
                                        ['product', 'New product'],
                                        ['cart', 'Abandoned cart'],
                                        ['followup', 'Order follow-up'],
                                        ['coupon', 'Coupon drop'],
                                    ] as const).map(([type, label]) => (
                                        <button key={type} onClick={() => applyStarterLayout(type)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Layers size={15} />{label}</button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {builderTab === 'layouts' && selectedSection && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 space-y-3">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Section settings</p>
                                <Field label="Name" value={selectedSection.name || ''} onChange={(value) => updateSection('name', value)} />
                                <Field label="Background" value={selectedSection.backgroundColor || ''} onChange={(value) => updateSection('backgroundColor', value)} />
                                <Field label="Padding" value={selectedSection.padding || ''} onChange={(value) => updateSection('padding', value)} />
                                <SelectField label="Visibility" value={selectedSection.visibility || 'all'} options={['all', 'desktop', 'mobile']} onChange={(value) => updateSection('visibility', value)} />
                                <SelectField label="Mobile stack" value={selectedSection.stackMode || 'stack'} options={['stack', 'reverse', 'none']} onChange={(value) => updateSection('stackMode', value)} />
                                <button onClick={deleteSelectedSection} disabled={design.document.sections.length <= 1} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash2 size={14} />Delete section</button>
                            </div>
                        )}
                        {builderTab === 'global' && (
                            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 space-y-3">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Global styles</p>
                                <Field label="Email background" value={design.document.theme.backgroundColor} onChange={(value) => updateTheme('backgroundColor', value)} />
                                <Field label="Content background" value={design.document.theme.contentBackgroundColor} onChange={(value) => updateTheme('contentBackgroundColor', value)} />
                                <Field label="Text color" value={design.document.theme.textColor} onChange={(value) => updateTheme('textColor', value)} />
                                <Field label="Primary color" value={design.document.theme.primaryColor} onChange={(value) => updateTheme('primaryColor', value)} />
                                <Field label="Font family" value={design.document.theme.fontFamily} onChange={(value) => updateTheme('fontFamily', value)} />
                                <Field label="Content width" type="number" value={String(design.document.theme.contentWidth)} onChange={(value) => updateTheme('contentWidth', Number(value) || 640)} />
                                <Field label="Border radius" type="number" value={String(design.document.theme.borderRadius)} onChange={(value) => updateTheme('borderRadius', Number(value) || 0)} />
                            </div>
                        )}
                        <div className="mt-auto flex border-t border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
                            <button onClick={() => setBuilderTab('layouts')} className="flex flex-1 items-center justify-center gap-1 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"><Settings size={14} />Layout Settings</button>
                            <button onClick={() => setBuilderTab('global')} className="flex flex-1 items-center justify-center gap-1 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"><Globe2 size={14} />Global Settings</button>
                        </div>
                    </aside>

                    <main className="min-h-0 overflow-auto bg-slate-200/70 p-4 dark:bg-slate-950">
                        <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3">
                            <p className="text-sm text-slate-600 dark:text-slate-300">Drag blocks from the left into any section below, or use click-to-add.</p>
                            <div className="flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                                <button onClick={() => setPreviewMode('desktop')} className={`rounded-md p-2 ${previewMode === 'desktop' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}><Monitor size={16} /></button>
                                <button onClick={() => setPreviewMode('mobile')} className={`rounded-md p-2 ${previewMode === 'mobile' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}><Smartphone size={16} /></button>
                            </div>
                        </div>
                        <EmailDropCanvas sections={design.document.sections} selectedSectionId={selectedSectionId} selectedBlockId={selectedBlockId} onSelectSection={(id) => { setSelectedSectionId(id); setSelectedBlockId(null); }} onSelectBlock={setSelectedBlockId} onUpdateBlock={updateBlockById} onDuplicateBlock={duplicateBlock} onDeleteBlock={deleteBlockById} onOpenSettings={() => { setActivePanel('settings'); }} onDropOnSection={handleDropOnSection} />
                        <div className={`mx-auto bg-white shadow-2xl transition-all ${previewMode === 'mobile' ? 'max-w-[430px] rounded-[2rem] border-[10px] border-slate-900 p-2 shadow-slate-900/30' : 'max-w-4xl rounded-2xl'}`}>
                            <iframe title="Email preview" srcDoc={html} className={`${previewMode === 'mobile' ? 'h-[620px] rounded-[1.25rem]' : 'h-[calc(100vh-190px)] rounded-2xl'} w-full border-0`} />
                        </div>
                    </main>

                    <aside className="min-h-0 overflow-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        {activePanel === 'checklist' && <ChecklistPanel issues={issues} groupedIssues={groupedIssues} />}
                        {activePanel === 'history' && <HistoryPanel snapshots={snapshots} onRestore={(snapshot) => { setDesign(cloneDesign(snapshot.design)); setSelectedSectionId(snapshot.design.document.sections[0]?.id || ''); setSelectedBlockId(null); setHasUnsavedChanges(true); }} />}
                        {activePanel === 'test' && (
                            <div className="space-y-3">
                                <p className="font-semibold text-slate-900 dark:text-white">Send test email</p>
                                <Field label="Recipient" value={testEmail} onChange={setTestEmail} type="email" />
                                {recentRecipients.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {recentRecipients.map((recipient) => (
                                            <button key={recipient} onClick={() => setTestEmail(recipient)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-800 dark:text-slate-300">{recipient}</button>
                                        ))}
                                    </div>
                                )}
                                {testStatus && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{testStatus}</p>}
                                {missingEmailAccount && <button onClick={() => { window.location.href = '/settings?tab=email'; }} className="inline-flex w-full items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">Set up email account</button>}
                                <button onClick={sendTestEmail} disabled={sendingTest} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{sendingTest ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}Send test</button>
                            </div>
                        )}
                        {!['checklist', 'history', 'test'].includes(activePanel) && (
                            <BlockEditor block={selectedBlock} onUpdate={updateBlock} onDelete={deleteSelectedBlock} sections={design.document.sections} selectedSectionId={selectedSectionId} onSelectBlock={setSelectedBlockId} onDropOnSection={handleDropOnSection} />
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
        </label>
    );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
        </label>
    );
}

function PaletteGrid({ items, onAdd }: { items: PaletteItem[]; onAdd: (key: PaletteKey) => void }) {
    return (
        <div className="grid grid-cols-4 gap-3">
            {items.map((item) => {
                const Icon = item.icon;
                return (
                    <button
                        key={item.key}
                        draggable
                        onDragStart={(event) => {
                            event.dataTransfer.setData('application/x-overseek-block', item.key);
                            event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => onAdd(item.key)}
                        className="group flex min-h-[66px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-400 bg-white px-2 py-2 text-center text-xs text-slate-500 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-indigo-950/30"
                        title={`Drag ${item.label} into the email`}
                    >
                        <Icon size={26} className="mb-1 text-slate-400 group-hover:text-indigo-500" />
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}

function EmailDropCanvas({ sections, selectedSectionId, selectedBlockId, onSelectSection, onSelectBlock, onUpdateBlock, onDuplicateBlock, onDeleteBlock, onOpenSettings, onDropOnSection }: { sections: EmailSection[]; selectedSectionId: string; selectedBlockId: string | null; onSelectSection: (id: string) => void; onSelectBlock: (id: string) => void; onUpdateBlock: (id: string, updater: (block: EmailBlock) => void) => void; onDuplicateBlock: (id: string) => void; onDeleteBlock: (id: string) => void; onOpenSettings: () => void; onDropOnSection: (event: DragEvent, sectionId: string, insertIndex?: number) => void }) {
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    return (
        <div className="mx-auto mb-3 max-w-4xl space-y-2">
            {sections.map((section) => {
                const blocks = section.columns.flatMap((column) => column.blocks);
                return (
                    <div key={section.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { setDropTarget(null); onDropOnSection(event, section.id); }} className={`rounded-xl border border-dashed p-3 transition ${selectedSectionId === section.id ? 'border-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/30' : 'border-slate-300 bg-white/60 dark:border-slate-700 dark:bg-slate-900/50'}`}>
                        <button onClick={() => onSelectSection(section.id)} className="mb-2 flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <span>{section.name || 'Section'} · {blocks.length} block{blocks.length === 1 ? '' : 's'}</span>
                            <span>Drop here</span>
                        </button>
                        <div className="space-y-2">
                            {blocks.length === 0 && <div className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400 dark:border-slate-700">Drag a block into this section</div>}
                            {blocks.map((block, index) => (
                                <div
                                    key={block.id}
                                    draggable
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData('application/x-overseek-existing-block', block.id);
                                        event.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDragOver={(event) => { event.preventDefault(); setDropTarget(`${section.id}:${index}`); }}
                                    onDragLeave={() => setDropTarget(null)}
                                    onDrop={(event) => { setDropTarget(null); onDropOnSection(event, section.id, index); }}
                                    onClick={() => { onSelectSection(section.id); onSelectBlock(block.id); }}
                                    className="group relative"
                                >
                                    <div className={`mb-1 h-1 rounded-full transition ${dropTarget === `${section.id}:${index}` ? 'bg-indigo-500' : 'bg-transparent'}`} />
                                    <div className={`rounded-lg border bg-white p-3 text-sm shadow-sm transition dark:bg-slate-800 ${selectedBlockId === block.id ? 'border-indigo-400 ring-2 ring-indigo-100 dark:ring-indigo-950' : 'border-slate-200 hover:border-indigo-300 dark:border-slate-700'}`}>
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><GripVertical size={14} />{getEmailDesignV2BlockLabel(block)}</span>
                                            <div className="flex opacity-0 transition group-hover:opacity-100">
                                                <button type="button" onClick={(event) => { event.stopPropagation(); onDuplicateBlock(block.id); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700"><Copy size={14} /></button>
                                                <button type="button" onClick={(event) => { event.stopPropagation(); onSelectBlock(block.id); onOpenSettings(); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700"><Settings size={14} /></button>
                                                <button type="button" onClick={(event) => { event.stopPropagation(); onDeleteBlock(block.id); }} className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 size={14} /></button>
                                            </div>
                                        </div>
                                        <InlineBlockEditor block={block} onUpdate={(updater) => onUpdateBlock(block.id, updater)} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function InlineBlockEditor({ block, onUpdate }: { block: EmailBlock; onUpdate: (updater: (block: EmailBlock) => void) => void }) {
    if (block.type === 'text') {
        return <textarea value={block.props.html} onChange={(event) => onUpdate((draft) => { if (draft.type === 'text') draft.props.html = event.target.value; })} rows={3} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />;
    }
    if (block.type === 'button') {
        return <input value={block.props.label} onChange={(event) => onUpdate((draft) => { if (draft.type === 'button') draft.props.label = event.target.value; })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-center text-sm font-semibold text-indigo-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300" />;
    }
    if (block.type === 'image') {
        return <div className="space-y-2"><input value={block.props.src} onChange={(event) => onUpdate((draft) => { if (draft.type === 'image') draft.props.src = event.target.value; })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /><p className="text-xs text-slate-400">Image URL</p></div>;
    }
    if (block.type === 'coupon') {
        return <input value={block.props.headline} onChange={(event) => onUpdate((draft) => { if (draft.type === 'coupon') draft.props.headline = event.target.value; })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />;
    }
    return <p className="text-xs text-slate-500">Use settings to edit this block.</p>;
}

function BlockEditor({ block, sections, selectedSectionId, onUpdate, onDelete, onSelectBlock, onDropOnSection }: { block: EmailBlock | null; sections: EmailSection[]; selectedSectionId: string; onUpdate: (updater: (block: EmailBlock) => void) => void; onDelete: () => void; onSelectBlock: (id: string) => void; onDropOnSection: (event: DragEvent, sectionId: string, insertIndex?: number) => void }) {
    if (!block) {
        const section = sections.find((item) => item.id === selectedSectionId);
        return (
            <div className="space-y-3">
                <p className="font-semibold text-slate-900 dark:text-white">Blocks in section</p>
                {section?.columns.flatMap((column) => column.blocks).length ? section.columns.flatMap((column) => column.blocks).map((item, index) => (
                    <button key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-overseek-existing-block', item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDropOnSection(event, selectedSectionId, index)} onClick={() => onSelectBlock(item.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800">
                        <span className="inline-flex items-center gap-2"><GripVertical size={14} className="text-slate-400" />{getEmailDesignV2BlockLabel(item)}</span> <Eye size={14} />
                    </button>
                )) : <p className="text-sm text-slate-500">Select a block or add one from the left panel.</p>}
            </div>
        );
    }

    const patchProps = (props: Record<string, unknown>) => onUpdate((draft) => { Object.assign(draft.props, props); });
    const setVisibility = (value: string) => onUpdate((draft) => { draft.visibility = value as EmailDeviceVisibility; });

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900 dark:text-white">{getEmailDesignV2BlockLabel(block)}</p>
                <button onClick={onDelete} className="rounded-lg border border-red-200 p-2 text-red-700 hover:bg-red-50"><Trash2 size={14} /></button>
            </div>
            <SelectField label="Visibility" value={block.visibility || 'all'} options={['all', 'desktop', 'mobile']} onChange={setVisibility} />
            {block.type === 'text' && <TextArea label="HTML" value={block.props.html} onChange={(value) => patchProps({ html: value })} />}
            {block.type === 'image' && <><Field label="Image URL" value={block.props.src} onChange={(value) => patchProps({ src: value })} /><Field label="Alt text" value={block.props.alt} onChange={(value) => patchProps({ alt: value })} /><Field label="Link" value={block.props.href || ''} onChange={(value) => patchProps({ href: value })} /></>}
            {block.type === 'button' && <><Field label="Label" value={block.props.label} onChange={(value) => patchProps({ label: value })} /><Field label="URL" value={block.props.href} onChange={(value) => patchProps({ href: value })} /></>}
            {block.type === 'spacer' && <Field label="Height" type="number" value={String(block.props.height)} onChange={(value) => patchProps({ height: Number(value) || 0 })} />}
            {block.type === 'divider' && <Field label="Color" value={block.props.color || ''} onChange={(value) => patchProps({ color: value })} />}
            {block.type === 'product' && <><Field label="Button label" value={block.props.buttonLabel} onChange={(value) => patchProps({ buttonLabel: value })} /><Field label="Button URL" value={block.props.buttonHref} onChange={(value) => patchProps({ buttonHref: value })} /></>}
            {block.type === 'orderSummary' && <Field label="Heading" value={block.props.heading} onChange={(value) => patchProps({ heading: value })} />}
            {block.type === 'address' && <><Field label="Title" value={block.props.title} onChange={(value) => patchProps({ title: value })} /><SelectField label="Source" value={block.props.source} options={['billing', 'shipping']} onChange={(value) => patchProps({ source: value })} /></>}
            {block.type === 'coupon' && <><Field label="Headline" value={block.props.headline} onChange={(value) => patchProps({ headline: value })} /><Field label="Code" value={block.props.code} onChange={(value) => patchProps({ code: value })} /><Field label="Description" value={block.props.description} onChange={(value) => patchProps({ description: value })} /></>}
            {block.type === 'rawHtml' && <TextArea label="Raw HTML" value={block.props.html} onChange={(value) => patchProps({ html: value })} />}
        </div>
    );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={8} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
        </label>
    );
}

function ChecklistPanel({ issues, groupedIssues }: { issues: PreflightIssue[]; groupedIssues: ReturnType<typeof groupPreflightIssues> }) {
    if (issues.length === 0) {
        return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle size={18} className="mb-2" />No issues found.</div>;
    }
    return (
        <div className="space-y-3">
            <p className="font-semibold text-slate-900 dark:text-white">Preflight checklist</p>
            {[...groupedIssues.blocking, ...groupedIssues.warning].map((issue) => (
                <div key={issue.id} className={`rounded-lg border px-3 py-2 text-sm ${issue.severity === 'blocking' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><AlertTriangle size={14} className="mb-1" />{issue.message}</div>
            ))}
        </div>
    );
}

function HistoryPanel({ snapshots, onRestore }: { snapshots: Snapshot[]; onRestore: (snapshot: Snapshot) => void }) {
    return (
        <div className="space-y-3">
            <p className="font-semibold text-slate-900 dark:text-white">Version history</p>
            {snapshots.length === 0 ? <p className="text-sm text-slate-500">Save to create the first snapshot.</p> : snapshots.map((snapshot) => (
                <button key={snapshot.id} onClick={() => onRestore(snapshot)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800">
                    {new Date(snapshot.createdAt).toLocaleString()} <span className="text-indigo-600">Restore</span>
                </button>
            ))}
        </div>
    );
}
