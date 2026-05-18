import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle, ClipboardList, Eye, Globe2, GripVertical, History, Layers, Loader2, Monitor, Pencil, Save, Search, Send, Settings, Smartphone, Trash2, Upload, X } from 'lucide-react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { ErrorBoundary } from '../ui/ErrorBoundary';
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
    type SocialIconStyle,
} from '../../lib/emailDesignerV2';
import { createAccountFooterHtml, createBlock, createPaletteBlock, paletteItems, type PaletteKey } from './emailDesignerV2/blockFactory';
import { EmailDropCanvas } from './emailDesignerV2/EmailDropCanvas';
import { PaletteGrid } from './emailDesignerV2/PaletteGrid';
import { ProductPicker } from './emailDesignerV2/ProductPicker';
import { productToBlockProps } from './emailDesignerV2/productBlockProps';

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

interface InvoiceTemplateRecord {
    layout?: string | { items?: Array<{ type?: string; logo?: string; content?: string }> };
}

const DRAFT_STORAGE_KEY = 'overseek-email-builder-v2-draft';
const HISTORY_STORAGE_KEY = 'overseek-email-builder-v2-history';
const MAX_HISTORY = 12;

type Panel = 'blocks' | 'settings' | 'checklist' | 'history' | 'test';
type BuilderTab = 'structure' | 'blocks' | 'layouts' | 'global';

interface StructurePreset {
    id: string;
    widths: number[];
}

const STRUCTURE_PRESETS: StructurePreset[] = [
    { id: 'one-column', widths: [100] },
    { id: 'two-equal', widths: [50, 50] },
    { id: 'one-third-two-third', widths: [33, 67] },
    { id: 'two-third-one-third', widths: [67, 33] },
    { id: 'three-equal', widths: [33, 34, 33] },
    { id: 'quarter-half-quarter', widths: [25, 50, 25] },
    { id: 'four-equal', widths: [25, 25, 25, 25] },
    { id: 'narrow-wide-narrow-wide', widths: [17, 33, 17, 33] },
    { id: 'wide-narrow-narrow-wide', widths: [33, 17, 17, 33] },
];

const cloneDesign = (design: EmailDesignV2Envelope): EmailDesignV2Envelope => (
    typeof structuredClone === 'function' ? structuredClone(design) : JSON.parse(JSON.stringify(design))
);

const RECENT_TEST_RECIPIENTS_KEY = 'overseek-email-builder-v2-test-recipients';
const MAX_TEST_RECIPIENTS = 5;
const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'X', 'Twitter', 'LinkedIn', 'Pinterest'];
const SOCIAL_ICON_STYLES: SocialIconStyle[] = ['solid', 'outline', 'glyph'];

function parseBoxSpacing(value: string): [number, number, number, number] {
    const parts = value.trim().split(/\s+/).map((part) => Number(part.replace('px', '')) || 0);
    if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
    if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
    if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] || 0];
}

function toBoxSpacing(values: [number, number, number, number]): string {
    return values.map((value) => `${Math.max(0, Math.round(value))}px`).join(' ');
}

function normalizeColumnWidths(section: EmailSection) {
    if (section.columns.length === 0) return;
    const total = section.columns.reduce((sum, column) => sum + Math.max(1, column.width || 0), 0);
    let running = 0;
    section.columns.forEach((column, index) => {
        if (index === section.columns.length - 1) {
            column.width = Math.max(1, 100 - running);
            return;
        }
        const next = Math.max(1, Math.round((Math.max(1, column.width || 0) / total) * 100));
        column.width = next;
        running += next;
    });
}

function isEmailSafeImageUrl(value: string): boolean {
    const candidate = value.trim();
    if (!candidate) return false;
    return /^(https?:|data:|cid:)/i.test(candidate);
}

export function EmailDesignEditorV2({ initialDesign, initialSubject = '', initialPreviewText = '', onSave, onCancel }: Props) {
    const { token, user } = useAuth();
    const { currentAccount, refreshAccounts } = useAccount();
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
    const [previewSurface, setPreviewSurface] = useState<'canvas' | 'html'>('canvas');
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
    const [invoiceLogoUrl, setInvoiceLogoUrl] = useState('');

    const html = useMemo(() => compileEmailDesignV2(design), [design]);
    const iframePreviewHtml = useMemo(() => {
        const baseHref = typeof window !== 'undefined' ? window.location.origin : '';
        if (!baseHref) return html;
        return html.includes('<head>')
            ? html.replace('<head>', `<head><base href="${baseHref}/">`)
            : html;
    }, [html]);
    const selectedSection = design.document.sections.find((section) => section.id === selectedSectionId) || design.document.sections[0];
    const selectedBlock = selectedSection?.columns.flatMap((column) => column.blocks).find((block) => block.id === selectedBlockId) || null;
    const groupedIssues = groupPreflightIssues(issues);
    const visiblePaletteItems = paletteItems.filter((item) => item.label.toLowerCase().includes(blockSearch.trim().toLowerCase()));
    const saveStatus = saving ? 'Saving...' : hasUnsavedChanges ? 'Autosaved draft' : lastSavedAt ? `Saved ${lastSavedAt.toLocaleTimeString()}` : 'Ready';
    const isUtilityPanel = activePanel === 'checklist' || activePanel === 'history' || activePanel === 'test';
    const isInvoiceDownloadBlock = selectedBlock?.type === 'button' && (selectedBlock.props.href || '').trim() === '{{order.invoiceUrl}}';
    const hideRightSidebar = (selectedBlock?.type === 'text' || selectedBlock?.type === 'footer' || isInvoiceDownloadBlock) && !isUtilityPanel;
    const hideOnDesktop = selectedSection?.visibility === 'mobile';
    const hideOnMobile = selectedSection?.visibility === 'desktop';

    const appearanceLogoUrl = currentAccount?.appearance?.logoUrl || '';
    const brandLogoUrl = isEmailSafeImageUrl(invoiceLogoUrl) ? invoiceLogoUrl : appearanceLogoUrl;
    const accountName = currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store';
    const accountFooterHtml = currentAccount?.appearance?.emailFooterHtml || createAccountFooterHtml(accountName);

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

    const addStructurePreset = (widths: number[], insertIndex?: number) => {
        setDirtyDesign((draft) => {
            const section: EmailSection = {
                id: createEmailDesignId('section'),
                name: widths.length === 1 ? 'New section' : `${widths.length}-column section`,
                backgroundColor: draft.document.theme.contentBackgroundColor,
                padding: '22px 28px',
                visibility: 'all',
                stackMode: 'stack',
                columns: widths.map((width) => ({
                    id: createEmailDesignId('column'),
                    width,
                    blocks: [],
                })),
            };
            if (typeof insertIndex === 'number') {
                draft.document.sections.splice(insertIndex, 0, section);
            } else {
                draft.document.sections.push(section);
            }
            setSelectedSectionId(section.id);
            setSelectedBlockId(null);
        });
    };

    const handleDropStructure = (event: DragEvent, insertIndex: number) => {
        event.preventDefault();
        event.stopPropagation();
        const structureWidths = event.dataTransfer.getData('application/x-overseek-structure');
        if (!structureWidths) return;
        addStructurePreset(JSON.parse(structureWidths) as number[], insertIndex);
    };

    const addPaletteBlock = (sectionId: string, key: PaletteKey, insertIndex?: number, columnId?: string) => {
        const logoUrl = brandLogoUrl;
        const socialLinks = currentAccount?.appearance?.socialLinks || [];
        const block = createPaletteBlock(key, accountName, logoUrl, socialLinks, accountFooterHtml);
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === sectionId);
            const column = columnId ? section?.columns.find((item) => item.id === columnId) : section?.columns[0];
            const blocks = column?.blocks;
            if (!blocks) return;
            if (typeof insertIndex === 'number') blocks.splice(insertIndex, 0, block);
            else blocks.push(block);
            setSelectedSectionId(sectionId);
            setSelectedBlockId(block.id);
        });
    };

    const moveBlock = (blockId: string, targetSectionId: string, targetIndex?: number, columnId?: string) => {
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
            const targetColumn = columnId ? targetSection?.columns.find((item) => item.id === columnId) : targetSection?.columns[0];
            const blocks = targetColumn?.blocks;
            if (!blocks) return;
            const nextIndex = typeof targetIndex === 'number' ? Math.min(targetIndex, blocks.length) : blocks.length;
            blocks.splice(nextIndex, 0, movingBlock);
            setSelectedSectionId(targetSectionId);
            setSelectedBlockId(blockId);
        });
    };

    const handleDropOnSection = (event: DragEvent, sectionId: string, insertIndex?: number, columnId?: string) => {
        event.preventDefault();
        event.stopPropagation();
        const structureWidths = event.dataTransfer.getData('application/x-overseek-structure');
        const paletteKey = event.dataTransfer.getData('application/x-overseek-block') as PaletteKey;
        const blockId = event.dataTransfer.getData('application/x-overseek-existing-block');
        if (structureWidths) return;
        else if (paletteKey) addPaletteBlock(sectionId, paletteKey, insertIndex, columnId);
        else if (blockId) moveBlock(blockId, sectionId, insertIndex, columnId);
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

    const updateSelectedSection = (updater: (section: EmailSection) => void) => {
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === selectedSectionId);
            if (!section) return;
            updater(section);
        });
    };

    const updateSectionPaddingSide = (sideIndex: number, value: string) => {
        updateSelectedSection((section) => {
            const next = parseBoxSpacing(section.padding || '0');
            next[sideIndex] = Number(value) || 0;
            section.padding = toBoxSpacing(next);
        });
    };

    const updateSectionBorderRadiusSide = (sideIndex: number, value: string) => {
        updateSelectedSection((section) => {
            const current = section.borderRadius || [0, 0, 0, 0];
            const next: [number, number, number, number] = [current[0], current[1], current[2], current[3]];
            next[sideIndex] = Number(value) || 0;
            section.borderRadius = next;
        });
    };

    const updateSectionColumnWidth = (columnId: string, value: string) => {
        updateSelectedSection((section) => {
            const width = Math.max(5, Math.min(100, Number(value) || 0));
            const column = section.columns.find((item) => item.id === columnId);
            if (!column) return;
            column.width = width;
            normalizeColumnWidths(section);
        });
    };

    const addSectionColumn = () => {
        updateSelectedSection((section) => {
            const nextCount = section.columns.length + 1;
            const width = Math.max(10, Math.floor(100 / nextCount));
            section.columns.push({ id: createEmailDesignId('column'), width, blocks: [] });
            normalizeColumnWidths(section);
        });
    };

    const removeSectionColumn = (columnId: string) => {
        updateSelectedSection((section) => {
            if (section.columns.length <= 1) return;
            const index = section.columns.findIndex((item) => item.id === columnId);
            if (index < 0) return;
            const removed = section.columns[index];
            const fallbackIndex = index === 0 ? 1 : index - 1;
            const fallback = section.columns[fallbackIndex];
            if (removed?.blocks?.length && fallback) {
                fallback.blocks.unshift(...removed.blocks);
            }
            section.columns = section.columns.filter((item) => item.id !== columnId);
            normalizeColumnWidths(section);
        });
    };

    const setSectionHideOnDesktop = (checked: boolean) => {
        updateSelectedSection((section) => {
            if (checked) section.visibility = 'mobile';
            else if (section.visibility === 'mobile') section.visibility = 'all';
        });
    };

    const setSectionHideOnMobile = (checked: boolean) => {
        updateSelectedSection((section) => {
            if (checked) section.visibility = 'desktop';
            else if (section.visibility === 'desktop') section.visibility = 'all';
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
                    if (column.blocks[index]?.type === 'footer') return;
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
                    column.blocks = column.blocks.filter((block) => block.id !== blockId || block.type === 'footer');
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
                    column.blocks = column.blocks.filter((block) => block.id !== selectedBlockId || block.type === 'footer');
                }
            }
            setSelectedBlockId(null);
        });
    };

    const deleteSectionById = (sectionId: string) => {
        if (design.document.sections.length <= 1) return;
        setDirtyDesign((draft) => {
            draft.document.sections = draft.document.sections.filter((section) => section.id !== sectionId);
            setSelectedSectionId(draft.document.sections[0]?.id || '');
            setSelectedBlockId(null);
        });
    };

    const deleteSelectedSection = () => {
        if (!selectedSection) return;
        deleteSectionById(selectedSection.id);
    };

    const saveSocialLinksAsDefaults = async (links: Array<{ label: string; href: string }>) => {
        if (!currentAccount || !token) return;
        const appearance = {
            ...(currentAccount.appearance || {}),
            socialLinks: links.filter((link) => link.label.trim() && link.href.trim()),
        };
        const response = await fetch(`/api/accounts/${currentAccount.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ appearance }),
        });
        if (response.ok) {
            await refreshAccounts();
        }
    };

    const applyStarterLayout = (type: 'promo' | 'product' | 'cart' | 'followup' | 'coupon') => {
        const logoUrl = brandLogoUrl;
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
                    columns: [{ id: createEmailDesignId('column'), width: 100, blocks: [createPaletteBlock('footer', accountName, '', [], accountFooterHtml)] }],
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
        if (!token || !currentAccount) return;
        const loadInvoiceLogo = async () => {
            try {
                const response = await fetch('/api/invoices/templates', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-Account-ID': currentAccount.id,
                    },
                });
                if (!response.ok) return;
                const templates = await response.json() as InvoiceTemplateRecord[];
                const layout = templates[0]?.layout;
                const parsed = typeof layout === 'string' ? JSON.parse(layout) as { items?: Array<{ type?: string; logo?: string; content?: string }> } : layout;
                const items = Array.isArray(parsed?.items) ? parsed.items : [];
                const logoItem = items.find((item) => item.logo || (item.type === 'image' && item.content));
                const logo = logoItem?.logo || logoItem?.content || '';
                if (logo) setInvoiceLogoUrl(logo);
            } catch {
                // Invoice logo is optional. Account appearance remains the fallback.
            }
        };
        loadInvoiceLogo();
    }, [currentAccount, token]);

    useEffect(() => {
        if (!brandLogoUrl) return;
        setDesign((current) => {
            const next = cloneDesign(current);
            let changed = false;
            for (const section of next.document.sections) {
                for (const column of section.columns) {
                    for (const block of column.blocks) {
                        if (block.type === 'siteLogo' && block.props.src !== brandLogoUrl) {
                            block.props.src = brandLogoUrl;
                            changed = true;
                        }
                    }
                }
            }
            return changed ? next : current;
        });
    }, [brandLogoUrl]);

    useEffect(() => {
        if (!accountFooterHtml) return;
        setDesign((current) => {
            const next = cloneDesign(current);
            let changed = false;
            for (const section of next.document.sections) {
                for (const column of section.columns) {
                    for (const block of column.blocks) {
                        if (block.type === 'footer' && block.props.html !== accountFooterHtml) {
                            block.props.html = accountFooterHtml;
                            changed = true;
                        }
                    }
                }
            }
            return changed ? next : current;
        });
    }, [accountFooterHtml]);

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
                <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex min-w-0 items-center gap-3 border-r border-slate-200 pr-4 dark:border-slate-800">
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
                    <div className="flex items-center justify-center gap-2">
                        <div className="flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                            <button onClick={() => setPreviewSurface('canvas')} className={`rounded-md px-2.5 py-2 text-xs font-semibold ${previewSurface === 'canvas' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Live canvas preview" aria-label="Live canvas preview">Canvas</button>
                            <button onClick={() => setPreviewSurface('html')} className={`rounded-md px-2.5 py-2 text-xs font-semibold ${previewSurface === 'html' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Real email HTML preview" aria-label="Real email HTML preview">Real Email</button>
                        </div>
                        <div className="flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                            <button onClick={() => setPreviewMode('desktop')} className={`rounded-md p-2 ${previewMode === 'desktop' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Desktop preview" aria-label="Desktop preview"><Monitor size={16} /></button>
                            <button onClick={() => setPreviewMode('mobile')} className={`rounded-md p-2 ${previewMode === 'mobile' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`} title="Mobile preview" aria-label="Mobile preview"><Smartphone size={16} /></button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
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

                <div className={`grid min-h-0 flex-1 grid-cols-1 ${hideRightSidebar ? 'lg:grid-cols-[324px_1fr]' : 'lg:grid-cols-[324px_1fr_360px]'}`}>
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
                                <p className="mb-3 text-sm font-medium text-slate-950 dark:text-white">Structure</p>
                                <div className="space-y-5">
                                    {STRUCTURE_PRESETS.map((preset) => (
                                        <StructureSkeleton key={preset.id} preset={preset} onAdd={() => addStructurePreset(preset.widths)} />
                                    ))}
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
                                <SelectField label="Background type" value={selectedSection.backgroundType || 'solid'} options={['solid']} onChange={(value) => updateSelectedSection((section) => { section.backgroundType = value as 'solid'; })} />
                                <ColorField label="Background color" value={selectedSection.backgroundColor || '#ffffff'} onChange={(value) => updateSection('backgroundColor', value)} />
                                <SelectField label="Border style" value={selectedSection.borderStyle || 'none'} options={['none', 'solid', 'dashed', 'dotted']} onChange={(value) => updateSelectedSection((section) => { section.borderStyle = value as EmailSection['borderStyle']; })} />
                                {(selectedSection.borderStyle || 'none') !== 'none' && (
                                    <>
                                        <ColorField label="Border color" value={selectedSection.borderColor || '#e2e8f0'} onChange={(value) => updateSelectedSection((section) => { section.borderColor = value; })} />
                                        <Field label="Border width" type="number" value={String(selectedSection.borderWidth ?? 1)} onChange={(value) => updateSelectedSection((section) => { section.borderWidth = Math.max(1, Number(value) || 1); })} />
                                    </>
                                )}
                                <FourSideField label="Border radius" values={selectedSection.borderRadius || [0, 0, 0, 0]} onChange={updateSectionBorderRadiusSide} />
                                <FourSideField label="Padding" values={parseBoxSpacing(selectedSection.padding || '0')} onChange={updateSectionPaddingSide} />
                                <ToggleField label="Hide on desktop" checked={hideOnDesktop} onChange={setSectionHideOnDesktop} />
                                <ToggleField label="Hide on mobile" checked={hideOnMobile} onChange={setSectionHideOnMobile} />
                                <SelectField label="Mobile stack" value={selectedSection.stackMode || 'stack'} options={['stack', 'reverse', 'none']} onChange={(value) => updateSection('stackMode', value)} />
                                <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Display condition</p>
                                        <button
                                            type="button"
                                            onClick={() => updateSelectedSection((section) => {
                                                const current = section.displayCondition?.enabled ?? false;
                                                section.displayCondition = {
                                                    enabled: !current,
                                                    expression: section.displayCondition?.expression || 'customer.isVip',
                                                };
                                            })}
                                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"
                                        >
                                            {selectedSection.displayCondition?.enabled ? 'Remove condition' : 'Add condition'}
                                        </button>
                                    </div>
                                    {selectedSection.displayCondition?.enabled && (
                                        <Field
                                            label="Condition expression"
                                            value={selectedSection.displayCondition.expression || ''}
                                            onChange={(value) => updateSelectedSection((section) => {
                                                section.displayCondition = { enabled: true, expression: value };
                                            })}
                                        />
                                    )}
                                </div>
                                <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Columns</p>
                                        <button onClick={addSectionColumn} disabled={selectedSection.columns.length >= 4} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200">Add column</button>
                                    </div>
                                    {selectedSection.columns.map((column, index) => (
                                        <div key={column.id} className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className="text-xs text-slate-600 dark:text-slate-300">Column {index + 1}</span>
                                                <button onClick={() => removeSectionColumn(column.id)} disabled={selectedSection.columns.length <= 1} className="text-xs text-red-600 disabled:opacity-40">Remove</button>
                                            </div>
                                            <Field label="Width %" type="number" value={String(column.width)} onChange={(value) => updateSectionColumnWidth(column.id, value)} />
                                        </div>
                                    ))}
                                </div>
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
                            <p className="text-sm text-slate-600 dark:text-slate-300">{previewSurface === 'canvas' ? 'Live email canvas. Drag blocks into place and edit content directly.' : 'Real email preview from compiled HTML. This is the exact markup that gets saved and sent.'}</p>
                        </div>
                        {previewSurface === 'canvas' ? (
                            <ErrorBoundary
                                onReset={() => {
                                    setSelectedSectionId((prev) => prev || design.document.sections[0]?.id || '');
                                    setSelectedBlockId(null);
                                }}
                            >
                                <EmailDropCanvas theme={design.document.theme} previewMode={previewMode} sections={design.document.sections} selectedSectionId={selectedSectionId} selectedBlockId={selectedBlockId} onSelectSection={(id) => { setSelectedSectionId(id); setSelectedBlockId(null); }} onSelectBlock={setSelectedBlockId} onUpdateBlock={updateBlockById} onDuplicateBlock={duplicateBlock} onDeleteBlock={deleteBlockById} onDeleteSection={deleteSectionById} onOpenSettings={() => { setActivePanel('settings'); }} onDropOnSection={handleDropOnSection} onDropStructure={handleDropStructure} />
                            </ErrorBoundary>
                        ) : (
                            <div className="mx-auto w-full rounded-3xl border border-slate-300 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                <div className="mx-auto overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700" style={{ width: previewMode === 'mobile' ? 390 : Math.min(design.document.theme.contentWidth, 920), maxWidth: '100%' }}>
                                    <iframe
                                        title="Compiled email HTML preview"
                                        srcDoc={iframePreviewHtml}
                                        className="h-[78vh] w-full bg-white"
                                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                                    />
                                </div>
                            </div>
                        )}
                    </main>

                    {!hideRightSidebar && <aside className="min-h-0 overflow-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <ErrorBoundary
                            onReset={() => {
                                setSelectedBlockId(null);
                                setActivePanel('blocks');
                            }}
                        >
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
                                <BlockEditor block={selectedBlock} onUpdate={updateBlock} onDelete={deleteSelectedBlock} canDelete={selectedBlock?.type !== 'footer'} sections={design.document.sections} selectedSectionId={selectedSectionId} onSelectBlock={setSelectedBlockId} onDropOnSection={handleDropOnSection} onSaveSocialDefaults={saveSocialLinksAsDefaults} token={token || undefined} accountId={currentAccount?.id} />
                            )}
                        </ErrorBoundary>
                    </aside>}
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="flex gap-2">
                <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-800" />
                <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
            </div>
        </label>
    );
}

function FourSideField({ label, values, onChange }: { label: string; values: [number, number, number, number]; onChange: (index: number, value: string) => void }) {
    const sideLabels = ['Top', 'Right', 'Bottom', 'Left'];
    return (
        <div className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="grid grid-cols-4 gap-2">
                {values.map((value, index) => (
                    <label key={`${label}-${sideLabels[index]}`} className="block">
                        <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">{sideLabels[index]}</span>
                        <input type="number" value={String(value)} onChange={(event) => onChange(index, event.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                    </label>
                ))}
            </div>
        </div>
    );
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
        </label>
    );
}

function StructureSkeleton({ preset, onAdd }: { preset: StructurePreset; onAdd: () => void }) {
    return (
        <button
            draggable
            onDragStart={(event) => {
                event.dataTransfer.setData('application/x-overseek-structure', JSON.stringify(preset.widths));
                event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={onAdd}
            className="w-full rounded-lg border border-slate-200 bg-white p-2 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-indigo-950/30"
            title="Drag structure into the email"
        >
            <div className="flex h-9 overflow-hidden rounded-md border border-dashed border-slate-500 dark:border-slate-500">
                {preset.widths.map((width, index) => (
                    <div key={`${preset.id}-${index}`} style={{ width: `${width}%` }} className="border-r border-dashed border-slate-500 last:border-r-0 dark:border-slate-500" />
                ))}
            </div>
        </button>
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

function BlockEditor({ block, sections, selectedSectionId, onUpdate, onDelete, canDelete, onSelectBlock, onDropOnSection, onSaveSocialDefaults, token, accountId }: { block: EmailBlock | null; sections: EmailSection[]; selectedSectionId: string; onUpdate: (updater: (block: EmailBlock) => void) => void; onDelete: () => void; canDelete: boolean; onSelectBlock: (id: string) => void; onDropOnSection: (event: DragEvent, sectionId: string, insertIndex?: number, columnId?: string) => void; onSaveSocialDefaults: (links: Array<{ label: string; href: string }>) => void; token?: string; accountId?: string }) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [showUrlInput, setShowUrlInput] = useState(false);
    const [urlDraft, setUrlDraft] = useState('');

    useEffect(() => {
        if (block?.type === 'image') {
            setUrlDraft(block.props.src || '');
        }
        setUploadError(null);
    }, [block]);

    if (!block) {
        const section = sections.find((item) => item.id === selectedSectionId);
        const blockEntries: Array<{ block: EmailBlock; index: number; columnId: string }> = [];
        for (const column of section?.columns || []) {
            column.blocks.forEach((item, index) => blockEntries.push({ block: item, index, columnId: column.id }));
        }
        return (
            <div className="space-y-3">
                <p className="font-semibold text-slate-900 dark:text-white">Blocks in section</p>
                {blockEntries.length ? blockEntries.map(({ block: item, index, columnId }) => (
                    <button key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-overseek-existing-block', item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDropOnSection(event, selectedSectionId, index, columnId)} onClick={() => onSelectBlock(item.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800">
                        <span className="inline-flex items-center gap-2"><GripVertical size={14} className="text-slate-400" />{getEmailDesignV2BlockLabel(item)}</span> <Eye size={14} />
                    </button>
                )) : <p className="text-sm text-slate-500">Select a block or add one from the left panel.</p>}
            </div>
        );
    }

    const patchProps = (props: Record<string, unknown>) => onUpdate((draft) => { Object.assign(draft.props, props); });
    const setVisibility = (value: string) => onUpdate((draft) => { draft.visibility = value as EmailDeviceVisibility; });

    const handleImageUpload = async (file: File) => {
        if (!token || !accountId) {
            setUploadError('Authentication required');
            return;
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            setUploadError('Invalid file type. Use PNG, JPG, GIF, SVG, or WebP.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError('File too large. Maximum size is 5MB.');
            return;
        }

        setUploadError(null);
        setIsUploading(true);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/invoices/templates/upload-image', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Account-ID': accountId,
                },
                body: formData,
            });

            if (!response.ok) {
                const payload = await response.json();
                throw new Error(payload?.error || 'Upload failed');
            }

            const payload = await response.json();
            if (!payload?.url) {
                throw new Error('Upload failed');
            }
            patchProps({ src: payload.url });
            setUrlDraft(payload.url);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to upload image';
            setUploadError(message);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900 dark:text-white">{getEmailDesignV2BlockLabel(block)}</p>
                {canDelete && <button onClick={onDelete} className="rounded-lg border border-red-200 p-2 text-red-700 hover:bg-red-50"><Trash2 size={14} /></button>}
            </div>
            <SelectField label="Visibility" value={block.visibility || 'all'} options={['all', 'desktop', 'mobile']} onChange={setVisibility} />
            {block.type === 'siteLogo' && <><Field label="Logo URL" value={block.props.src} onChange={(value) => patchProps({ src: value })} /><Field label="Fallback text" value={block.props.fallbackText || ''} onChange={(value) => patchProps({ fallbackText: value })} /></>}
            {block.type === 'text' && <TextArea label="HTML" value={block.props.html} onChange={(value) => patchProps({ html: value })} />}
            {block.type === 'image' && <>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleImageUpload(file);
                        event.currentTarget.value = '';
                    }}
                />
                <div className="rounded-lg border border-slate-300 bg-slate-200 px-4 py-6 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-900 text-slate-900">
                        <Upload size={18} />
                    </div>
                    <p className="text-sm font-semibold text-slate-900">Add Image</p>
                    <p className="mt-1 text-xs text-slate-700">Select files from your library or <button type="button" onClick={() => setShowUrlInput((current) => !current)} className="font-medium text-blue-700 underline underline-offset-2">Insert From URL</button></p>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="mt-3 inline-flex items-center justify-center rounded-md border border-blue-600 bg-white px-4 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isUploading ? 'Uploading...' : 'Upload Image'}
                    </button>
                </div>
                {showUrlInput && (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <Field label="Image URL" value={urlDraft} onChange={setUrlDraft} />
                        <button
                            type="button"
                            onClick={() => patchProps({ src: urlDraft.trim() })}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Use URL
                        </button>
                    </div>
                )}
                {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
                <Field label="Alt text" value={block.props.alt} onChange={(value) => patchProps({ alt: value })} />
                <Field label="Link" value={block.props.href || ''} onChange={(value) => patchProps({ href: value })} />
            </>}
            {block.type === 'button' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">Button content and styles are edited directly from the inline toolbar on the canvas.</div>}
            {block.type === 'list' && <ListEditor items={block.props.items} onChange={(items) => patchProps({ items })} />}
            {block.type === 'spacer' && <Field label="Height" type="number" value={String(block.props.height)} onChange={(value) => patchProps({ height: Number(value) || 0 })} />}
            {block.type === 'divider' && <Field label="Color" value={block.props.color || ''} onChange={(value) => patchProps({ color: value })} />}
            {block.type === 'product' && <><ProductPicker onSelect={(product) => patchProps(productToBlockProps(product))} />{block.props.productName && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">Selected: {block.props.productName}</p>}<Field label="Button label" value={block.props.buttonLabel} onChange={(value) => patchProps({ buttonLabel: value })} /><Field label="Button URL" value={block.props.buttonHref} onChange={(value) => patchProps({ buttonHref: value, productUrl: value })} /></>}
            {block.type === 'orderSummary' && <Field label="Heading" value={block.props.heading} onChange={(value) => patchProps({ heading: value })} />}
            {block.type === 'address' && <><Field label="Title" value={block.props.title} onChange={(value) => patchProps({ title: value })} /><SelectField label="Source" value={block.props.source} options={['billing', 'shipping']} onChange={(value) => patchProps({ source: value })} /></>}
            {block.type === 'coupon' && <><Field label="Headline" value={block.props.headline} onChange={(value) => patchProps({ headline: value })} /><Field label="Code" value={block.props.code} onChange={(value) => patchProps({ code: value })} /><Field label="Description" value={block.props.description} onChange={(value) => patchProps({ description: value })} /></>}
            {block.type === 'menu' && <LinkListEditor links={block.props.links} onChange={(links) => patchProps({ links })} />}
            {block.type === 'social' && <><SelectField label="Default icon style" value={block.props.iconStyle || 'solid'} options={SOCIAL_ICON_STYLES} onChange={(value) => patchProps({ iconStyle: value as SocialIconStyle })} /><SocialLinksEditor links={block.props.links} onChange={(links) => patchProps({ links })} onSaveDefaults={() => onSaveSocialDefaults(block.props.links)} /></>}
            {block.type === 'footer' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">Footer content is managed in Settings &gt; Email and is locked in the designer.</div>}
            {block.type === 'rawHtml' && <TextArea label="Raw HTML" value={block.props.html} onChange={(value) => patchProps({ html: value })} />}
        </div>
    );
}

function LinkListEditor({ links, onChange, onSaveDefaults }: { links: Array<{ label: string; href: string }>; onChange: (links: Array<{ label: string; href: string }>) => void; onSaveDefaults?: () => void }) {
    const updateLink = (index: number, key: 'label' | 'href', value: string) => {
        const next = links.map((link, itemIndex) => itemIndex === index ? { ...link, [key]: value } : link);
        onChange(next);
    };

    return (
        <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Links</p>
            {links.map((link, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <Field label="Label" value={link.label} onChange={(value) => updateLink(index, 'label', value)} />
                    <Field label="URL" value={link.href} onChange={(value) => updateLink(index, 'href', value)} />
                    <button onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-medium text-red-600 hover:text-red-700">Remove link</button>
                </div>
            ))}
            <button onClick={() => onChange([...links, { label: 'New Link', href: '{{store_url}}' }])} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Add link</button>
            {onSaveDefaults && <button onClick={onSaveDefaults} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Save as account social defaults</button>}
        </div>
    );
}

function SocialLinksEditor({ links, onChange, onSaveDefaults }: { links: Array<{ label: string; href: string; iconStyle?: SocialIconStyle }>; onChange: (links: Array<{ label: string; href: string; iconStyle?: SocialIconStyle }>) => void; onSaveDefaults: () => void }) {
    const updateLink = (index: number, key: 'label' | 'href' | 'iconStyle', value: string) => {
        const next = links.map((link, itemIndex) => {
            if (itemIndex !== index) return link;
            if (key === 'iconStyle' && value === 'default') {
                const rest = { ...link };
                delete rest.iconStyle;
                return rest;
            }
            return { ...link, [key]: value };
        });
        onChange(next);
    };

    return (
        <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Social Profiles</p>
            {links.map((link, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <SelectField label="Platform" value={link.label} options={SOCIAL_PLATFORMS.includes(link.label) ? SOCIAL_PLATFORMS : [link.label, ...SOCIAL_PLATFORMS]} onChange={(value) => updateLink(index, 'label', value)} />
                    <SelectField label="Icon style" value={link.iconStyle || 'default'} options={['default', ...SOCIAL_ICON_STYLES]} onChange={(value) => updateLink(index, 'iconStyle', value)} />
                    <Field label="URL" value={link.href} onChange={(value) => updateLink(index, 'href', value)} />
                    <button onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-medium text-red-600 hover:text-red-700">Remove profile</button>
                </div>
            ))}
            <button onClick={() => onChange([...links, { label: 'Facebook', href: '#', iconStyle: 'solid' }])} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Add social profile</button>
            <button onClick={onSaveDefaults} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Save as account social defaults</button>
        </div>
    );
}

function ListEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
    return (
        <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">List items</p>
            {items.map((item, index) => (
                <div key={index} className="flex gap-2">
                    <input value={item} onChange={(event) => onChange(items.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                    <button onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg border border-red-200 px-2 text-sm text-red-600 hover:bg-red-50">Remove</button>
                </div>
            ))}
            <button onClick={() => onChange([...items, 'New item'])} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Add item</button>
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
