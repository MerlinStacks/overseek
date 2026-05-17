import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, ClipboardList, Eye, History, Loader2, Mail, Monitor, Plus, Save, Send, Smartphone, Trash2, X } from 'lucide-react';
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
    onSave: (html: string, design: unknown) => void;
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

export function EmailDesignEditorV2({ initialDesign, onSave, onCancel }: Props) {
    const { token, user } = useAuth();
    const { currentAccount } = useAccount();
    const [design, setDesign] = useState<EmailDesignV2Envelope>(() => {
        return createEmailDesignV2FromUnknown(initialDesign, {
            appName: currentAccount?.appearance?.appName || currentAccount?.name || 'Your Store',
            logoUrl: currentAccount?.appearance?.logoUrl || '',
            primaryColor: currentAccount?.appearance?.primaryColor || '#4f46e5',
        });
    });
    const [selectedSectionId, setSelectedSectionId] = useState(() => design.document.sections[0]?.id || '');
    const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
    const [activePanel, setActivePanel] = useState<Panel>('blocks');
    const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
    const [saving, setSaving] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
    const [issues, setIssues] = useState<PreflightIssue[]>([]);
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [testEmail, setTestEmail] = useState(user?.email || '');
    const [testStatus, setTestStatus] = useState<string | null>(null);
    const [sendingTest, setSendingTest] = useState(false);

    const html = useMemo(() => compileEmailDesignV2(design), [design]);
    const selectedSection = design.document.sections.find((section) => section.id === selectedSectionId) || design.document.sections[0];
    const selectedBlock = selectedSection?.columns.flatMap((column) => column.blocks).find((block) => block.id === selectedBlockId) || null;
    const groupedIssues = groupPreflightIssues(issues);

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

    const addBlock = (type: EmailBlock['type']) => {
        if (!selectedSection) return;
        const block = createBlock(type);
        setDirtyDesign((draft) => {
            const section = draft.document.sections.find((item) => item.id === selectedSection.id);
            section?.columns[0]?.blocks.push(block);
            setSelectedBlockId(block.id);
        });
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

    const runChecklist = () => {
        setIssues(evaluateEmailPreflight({ html, subject: design.document.meta.title, emailCategory: design.document.meta.category || 'MARKETING' }));
        setActivePanel('checklist');
    };

    const saveDesign = () => {
        setSaving(true);
        saveSnapshot(design);
        onSave(html, design);
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
                setTestStatus(payload?.error || payload?.message || 'Failed to send test email.');
                return;
            }
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

    const blockButtons: Array<{ type: EmailBlock['type']; label: string }> = [
        { type: 'text', label: 'Text' },
        { type: 'image', label: 'Image' },
        { type: 'button', label: 'Button' },
        { type: 'product', label: 'Woo Product' },
        { type: 'orderSummary', label: 'Order Summary' },
        { type: 'address', label: 'Address' },
        { type: 'coupon', label: 'Coupon' },
        { type: 'divider', label: 'Divider' },
        { type: 'spacer', label: 'Spacer' },
        { type: 'rawHtml', label: 'Raw HTML' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/55 backdrop-blur-sm">
            <div className="flex h-full flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center gap-3">
                        <div className="rounded-xl bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"><Mail size={20} /></div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-950 dark:text-white">Overseek Email Designer V2</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Native builder with WooCommerce blocks, mobile controls, and safe HTML export.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`hidden rounded-full px-2.5 py-1 text-xs font-semibold md:inline-flex ${hasUnsavedChanges ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {hasUnsavedChanges ? 'Unsaved changes' : 'Saved'}{lastSavedAt ? ` at ${lastSavedAt.toLocaleTimeString()}` : ''}
                        </span>
                        <button onClick={runChecklist} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><ClipboardList size={16} />Checklist</button>
                        <button onClick={() => setActivePanel('history')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><History size={16} />History</button>
                        <button onClick={() => setActivePanel('test')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><Send size={16} />Test</button>
                        <button onClick={onCancel} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"><X size={16} />Close</button>
                        <button onClick={saveDesign} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}Save</button>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr_360px]">
                    <aside className="min-h-0 overflow-auto border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-4 grid grid-cols-2 gap-2">
                            <button onClick={() => setActivePanel('blocks')} className={`rounded-lg px-3 py-2 text-sm font-medium ${activePanel === 'blocks' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>Blocks</button>
                            <button onClick={() => setActivePanel('settings')} className={`rounded-lg px-3 py-2 text-sm font-medium ${activePanel === 'settings' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>Settings</button>
                        </div>

                        {activePanel === 'blocks' && (
                            <div className="space-y-4">
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sections</p>
                                    <div className="flex gap-2">
                                        <button onClick={() => addSection(1)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"><Plus size={14} className="inline" /> One column</button>
                                        <button onClick={() => addSection(2)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"><Plus size={14} className="inline" /> Two column</button>
                                    </div>
                                </div>
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add block to selected section</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {blockButtons.map((item) => (
                                            <button key={item.type} onClick={() => addBlock(item.type)} className="rounded-lg border border-slate-300 px-3 py-2 text-left text-sm text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-indigo-950/30">{item.label}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Document outline</p>
                                    <div className="space-y-2">
                                        {design.document.sections.map((section) => (
                                            <button key={section.id} onClick={() => { setSelectedSectionId(section.id); setSelectedBlockId(null); }} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selectedSectionId === section.id ? 'border-indigo-400 bg-indigo-50 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100' : 'border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-200'}`}>
                                                {section.name || 'Section'} <span className="text-xs text-slate-400">({section.columns.flatMap((column) => column.blocks).length} blocks)</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activePanel === 'settings' && selectedSection && (
                            <div className="space-y-3">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Section settings</p>
                                <Field label="Name" value={selectedSection.name || ''} onChange={(value) => updateSection('name', value)} />
                                <Field label="Background" value={selectedSection.backgroundColor || ''} onChange={(value) => updateSection('backgroundColor', value)} />
                                <Field label="Padding" value={selectedSection.padding || ''} onChange={(value) => updateSection('padding', value)} />
                                <SelectField label="Visibility" value={selectedSection.visibility || 'all'} options={['all', 'desktop', 'mobile']} onChange={(value) => updateSection('visibility', value)} />
                                <SelectField label="Mobile stack" value={selectedSection.stackMode || 'stack'} options={['stack', 'reverse', 'none']} onChange={(value) => updateSection('stackMode', value)} />
                                <button onClick={deleteSelectedSection} disabled={design.document.sections.length <= 1} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash2 size={14} />Delete section</button>
                            </div>
                        )}
                    </aside>

                    <main className="min-h-0 overflow-auto bg-slate-200/70 p-4 dark:bg-slate-950">
                        <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3">
                            <input value={design.document.meta.title} onChange={(event) => setDirtyDesign((draft) => { draft.document.meta.title = event.target.value; })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                            <div className="flex rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                                <button onClick={() => setPreviewMode('desktop')} className={`rounded-md p-2 ${previewMode === 'desktop' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}><Monitor size={16} /></button>
                                <button onClick={() => setPreviewMode('mobile')} className={`rounded-md p-2 ${previewMode === 'mobile' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}><Smartphone size={16} /></button>
                            </div>
                        </div>
                        <div className={`mx-auto rounded-2xl bg-white shadow-2xl transition-all ${previewMode === 'mobile' ? 'max-w-[390px]' : 'max-w-4xl'}`}>
                            <iframe title="Email preview" srcDoc={html} className="h-[calc(100vh-190px)] w-full rounded-2xl border-0" />
                        </div>
                    </main>

                    <aside className="min-h-0 overflow-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        {activePanel === 'checklist' && <ChecklistPanel issues={issues} groupedIssues={groupedIssues} />}
                        {activePanel === 'history' && <HistoryPanel snapshots={snapshots} onRestore={(snapshot) => { setDesign(cloneDesign(snapshot.design)); setSelectedSectionId(snapshot.design.document.sections[0]?.id || ''); setSelectedBlockId(null); setHasUnsavedChanges(true); }} />}
                        {activePanel === 'test' && (
                            <div className="space-y-3">
                                <p className="font-semibold text-slate-900 dark:text-white">Send test email</p>
                                <Field label="Recipient" value={testEmail} onChange={setTestEmail} type="email" />
                                {testStatus && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">{testStatus}</p>}
                                <button onClick={sendTestEmail} disabled={sendingTest} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{sendingTest ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}Send test</button>
                            </div>
                        )}
                        {!['checklist', 'history', 'test'].includes(activePanel) && (
                            <BlockEditor block={selectedBlock} onUpdate={updateBlock} onDelete={deleteSelectedBlock} sections={design.document.sections} selectedSectionId={selectedSectionId} onSelectBlock={setSelectedBlockId} />
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

function BlockEditor({ block, sections, selectedSectionId, onUpdate, onDelete, onSelectBlock }: { block: EmailBlock | null; sections: EmailSection[]; selectedSectionId: string; onUpdate: (updater: (block: EmailBlock) => void) => void; onDelete: () => void; onSelectBlock: (id: string) => void }) {
    if (!block) {
        const section = sections.find((item) => item.id === selectedSectionId);
        return (
            <div className="space-y-3">
                <p className="font-semibold text-slate-900 dark:text-white">Blocks in section</p>
                {section?.columns.flatMap((column) => column.blocks).length ? section.columns.flatMap((column) => column.blocks).map((item) => (
                    <button key={item.id} onClick={() => onSelectBlock(item.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800">
                        {getEmailDesignV2BlockLabel(item)} <Eye size={14} />
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
