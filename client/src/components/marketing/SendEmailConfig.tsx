/**
 * SendEmailConfig - Full configuration panel for Send Email action
 * Includes visual builder, rich text, raw HTML modes, template management, and preview
 */
import { useRef, useState, type RefObject } from 'react';
import { Search, Copy, X } from 'lucide-react';
import { RichTextEditor } from '../common/RichTextEditor';
import { MarketingEmailDesigner } from './MarketingEmailDesigner';
import { EmailTemplateSelectorModal } from './flow/EmailTemplateSelectorModal';
import { SaveAsTemplateModal } from './flow/SaveAsTemplateModal';
import { EmailPreviewModal } from './flow/EmailPreviewModal';
import type { EmailTemplate } from './flow/EmailTemplateSelectorModal';
import { evaluateEmailPreflight, groupPreflightIssues, type PreflightIssue } from '../../utils/emailPreflight';
import { EMAIL_MERGE_TAGS, type MergeTagDefinition } from './emailDesignerV2/mergeTags';

interface SendEmailNodeConfig {
    templateType?: 'visual' | 'richtext' | 'html';
    to?: string;
    subject?: string;
    previewText?: string;
    htmlContent?: string;
    designJson?: unknown;
    isTransactional?: boolean;
    emailCategory?: 'MARKETING' | 'TRANSACTIONAL';
    appendUtm?: boolean;
    campaignSource?: string;
    campaignMedium?: string;
    campaignName?: string;
    campaignTerm?: string;
    campaignContent?: string;
    overrideFrom?: boolean;
    fromName?: string;
    fromEmail?: string;
    replyToEmail?: string;
}

interface SendEmailConfigProps {
    config: SendEmailNodeConfig;
    onUpdate: (key: string, value: unknown) => void;
    onUpdateMany?: (updates: Record<string, unknown>) => void;
}

type MergeTagField = 'to' | 'subject' | 'previewText';

const MERGE_TAG_CATEGORIES: Array<{ id: MergeTagDefinition['category']; label: string }> = [
    { id: 'customer', label: 'Customer' },
    { id: 'order', label: 'Order' },
    { id: 'product', label: 'Product' },
    { id: 'coupon', label: 'Coupon' },
    { id: 'cart', label: 'Cart' },
    { id: 'general', label: 'General' },
];

export function SendEmailConfig({ config, onUpdate, onUpdateMany }: SendEmailConfigProps) {
    const [showTemplateSelector, setShowTemplateSelector] = useState(false);
    const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showVisualBuilder, setShowVisualBuilder] = useState(false);
    const [showPreflightModal, setShowPreflightModal] = useState(false);
    const [preflightIssues, setPreflightIssues] = useState<PreflightIssue[]>([]);
    const [showMergeTagModal, setShowMergeTagModal] = useState(false);
    const [mergeTagSearch, setMergeTagSearch] = useState('');
    const [mergeTagCategory, setMergeTagCategory] = useState<MergeTagDefinition['category']>('customer');
    const [activeMergeTagField, setActiveMergeTagField] = useState<MergeTagField>('subject');
    const toInputRef = useRef<HTMLInputElement>(null);
    const subjectInputRef = useRef<HTMLInputElement>(null);
    const previewTextInputRef = useRef<HTMLInputElement>(null);

    const templateType = config.templateType || 'visual';
    const emailCategory = config.emailCategory || (config.isTransactional ? 'TRANSACTIONAL' : 'MARKETING');

    const handleTemplateSelect = (template: EmailTemplate) => {
        const updates: Record<string, unknown> = {
            htmlContent: template.content,
            designJson: template.designJson,
        };

        if (template.subject) updates.subject = template.subject;

        if (onUpdateMany) {
            onUpdateMany(updates);
        } else {
            Object.entries(updates).forEach(([key, value]) => onUpdate(key, value));
        }
        setShowTemplateSelector(false);
    };

    const handleVisualBuilderSave = (html: string, design: unknown, meta?: { subject: string; previewText: string }) => {
        const updates: Record<string, unknown> = {
            htmlContent: html,
            designJson: design,
        };

        if (meta) {
            updates.subject = meta.subject;
            updates.previewText = meta.previewText;
        }

        if (onUpdateMany) {
            onUpdateMany(updates);
        } else {
            Object.entries(updates).forEach(([key, value]) => onUpdate(key, value));
        }
        setShowVisualBuilder(false);
    };

    const handleRichTextChange = (value: string) => {
        onUpdate('htmlContent', value);
    };

    const handleHtmlChange = (value: string) => {
        onUpdate('htmlContent', value);
    };

    const runPreflightChecks = (): PreflightIssue[] => evaluateEmailPreflight({
        html: config.htmlContent || '',
        subject: config.subject || '',
        emailCategory,
    });

    const handlePreviewAndTest = () => {
        const issues = runPreflightChecks();
        setPreflightIssues(issues);
        if (issues.length === 0) {
            setShowPreview(true);
            return;
        }
        setShowPreflightModal(true);
    };

    const hasBlockingIssues = preflightIssues.some((issue) => issue.severity === 'blocking');
    const groupedIssues = groupPreflightIssues(preflightIssues);

    const insertMergeTag = (
        field: MergeTagField,
        mergeTag: string,
        inputRef: RefObject<HTMLInputElement | null>,
    ) => {
        const input = inputRef.current;
        const currentValue = (config[field] as string) || '';

        if (!input) {
            onUpdate(field, currentValue + mergeTag);
            return;
        }

        const start = input.selectionStart ?? currentValue.length;
        const end = input.selectionEnd ?? currentValue.length;
        const nextValue = `${currentValue.slice(0, start)}${mergeTag}${currentValue.slice(end)}`;
        onUpdate(field, nextValue);

        requestAnimationFrame(() => {
            input.focus();
            const cursor = start + mergeTag.length;
            input.setSelectionRange(cursor, cursor);
        });
    };

    const openMergeTagModal = (field: MergeTagField) => {
        setActiveMergeTagField(field);
        setMergeTagSearch('');
        setShowMergeTagModal(true);
    };

    const getFieldRef = (field: MergeTagField) => {
        if (field === 'to') return toInputRef;
        if (field === 'subject') return subjectInputRef;
        return previewTextInputRef;
    };

    const visibleMergeTags = EMAIL_MERGE_TAGS.filter((tag) => {
        if (tag.category !== mergeTagCategory) return false;
        if (!mergeTagSearch.trim()) return true;
        const term = mergeTagSearch.trim().toLowerCase();
        return tag.label.toLowerCase().includes(term) || tag.value.toLowerCase().includes(term);
    });

    return (
        <div className="space-y-4">
            <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                    To <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <input
                        ref={toInputRef}
                        type="text"
                        value={config.to || '{{customer.email}}'}
                        onChange={(e) => onUpdate('to', e.target.value)}
                        placeholder="{{customer.email}}"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => openMergeTagModal('to')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                        title="Insert merge tag"
                    >
                        <span className="text-xs font-mono">{'{{...}}'}</span>
                    </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Use comma separated values to send email to multiple users.</p>
            </div>

            <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                    Subject <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <input
                        ref={subjectInputRef}
                        type="text"
                        value={config.subject || ''}
                        onChange={(e) => onUpdate('subject', e.target.value)}
                        placeholder="Thank you {{customer.firstName}}, Order {{order.number}} has been confirmed."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => openMergeTagModal('subject')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                        title="Insert merge tag"
                    >
                        <span className="text-xs font-mono">{'{{...}}'}</span>
                    </button>
                </div>
            </div>

            <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Preview Text</label>
                <div className="relative">
                    <input
                        ref={previewTextInputRef}
                        type="text"
                        value={config.previewText || ''}
                        onChange={(e) => onUpdate('previewText', e.target.value)}
                        placeholder="This is your order confirmation email, let's double check everything."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => openMergeTagModal('previewText')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                        title="Insert merge tag"
                    >
                        <span className="text-xs font-mono">{'{{...}}'}</span>
                    </button>
                </div>
            </div>

            <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Template Type</label>
                <div className="flex flex-wrap items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="radio"
                            name="templateType"
                            value="visual"
                            checked={templateType === 'visual'}
                            onChange={() => onUpdate('templateType', 'visual')}
                            className="h-4 w-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700">Visual Builder</span>
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">New</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="radio"
                            name="templateType"
                            value="richtext"
                            checked={templateType === 'richtext'}
                            onChange={() => onUpdate('templateType', 'richtext')}
                            className="h-4 w-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700">Rich Text</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="radio"
                            name="templateType"
                            value="html"
                            checked={templateType === 'html'}
                            onChange={() => onUpdate('templateType', 'html')}
                            className="h-4 w-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700">Raw HTML</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => setShowTemplateSelector(true)}
                        className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm transition-colors hover:bg-gray-50"
                    >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="3" y="3" width="7" height="7" rx="1" />
                            <rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" />
                            <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                        Templates
                    </button>
                </div>
            </div>

            {templateType === 'visual' && (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                    <div className="mb-3 flex justify-center">
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 shadow-sm">
                            <svg className="h-8 w-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
                                <path d="M3 9h18M9 21V9" strokeWidth="1.5" />
                            </svg>
                        </div>
                    </div>
                    {config.htmlContent ? (
                        <p className="mb-3 text-sm font-medium text-green-600">Email content configured</p>
                    ) : (
                        <p className="mb-3 text-sm text-gray-600">
                            Utilize our drag and drop builder to craft elegant email templates including WooCommerce blocks.
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowVisualBuilder(true)}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                    >
                        {config.htmlContent ? 'Edit Design' : 'Edit'}
                    </button>
                </div>
            )}

            {templateType === 'richtext' && (
                <div className="overflow-hidden rounded-lg border">
                    <RichTextEditor
                        value={config.htmlContent || ''}
                        onChange={handleRichTextChange}
                        placeholder="Write your email content here..."
                        variant="standard"
                    />
                </div>
            )}

            {templateType === 'html' && (
                <div>
                    <textarea
                        value={config.htmlContent || ''}
                        onChange={(e) => handleHtmlChange(e.target.value)}
                        placeholder={'<html>\n  <body>\n    Your email HTML here...\n  </body>\n</html>'}
                        rows={10}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            )}

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setShowSaveAsTemplate(true)}
                    disabled={!config.htmlContent}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Save As Template
                </button>
                <button
                    type="button"
                    onClick={handlePreviewAndTest}
                    disabled={!config.htmlContent}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Preview and Test
                </button>
            </div>

            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <label className="block text-sm font-medium text-blue-900">Delivery Category</label>
                <select
                    value={emailCategory}
                    onChange={(e) => {
                        const nextValue = e.target.value === 'TRANSACTIONAL' ? 'TRANSACTIONAL' : 'MARKETING';
                        onUpdate('emailCategory', nextValue);
                        onUpdate('isTransactional', nextValue === 'TRANSACTIONAL');
                    }}
                    className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                >
                    <option value="MARKETING">Marketing</option>
                    <option value="TRANSACTIONAL">Transactional</option>
                </select>
                <p className="text-xs text-blue-800">
                    Marketing emails honor unsubscribe preferences. Transactional emails can still be sent for important order or account updates.
                </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={config.appendUtm !== false}
                    onChange={(e) => onUpdate('appendUtm', e.target.checked)}
                    className="h-4 w-4 rounded text-blue-600"
                />
                <span className="text-sm text-gray-700">Automatically append UTM parameters to email links</span>
            </label>

            <div className="space-y-3">
                <div className="grid grid-cols-[140px_1fr] items-start gap-3">
                    <label className="pt-2 text-sm font-medium text-gray-700">Campaign Source</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignSource || ''}
                            onChange={(e) => onUpdate('campaignSource', e.target.value)}
                            placeholder=""
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">Referrer: (e.g., google, newsletter)</p>
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] items-start gap-3">
                    <label className="pt-2 text-sm font-medium text-gray-700">Campaign Medium</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignMedium || 'Email'}
                            onChange={(e) => onUpdate('campaignMedium', e.target.value)}
                            placeholder="Email"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">Marketing medium: (e.g., CPC, banner, email)</p>
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] items-start gap-3">
                    <label className="pt-2 text-sm font-medium text-gray-700">Campaign Name</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignName || ''}
                            onChange={(e) => onUpdate('campaignName', e.target.value)}
                            placeholder=""
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">Product, promo code, or slogan (e.g., spring_sale)</p>
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] items-start gap-3">
                    <label className="pt-2 text-sm font-medium text-gray-700">Campaign Term</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignTerm || ''}
                            onChange={(e) => onUpdate('campaignTerm', e.target.value)}
                            placeholder="Enter UTM term"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] items-start gap-3">
                    <label className="pt-2 text-sm font-medium text-gray-700">Campaign Content</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignContent || ''}
                            onChange={(e) => onUpdate('campaignContent', e.target.value)}
                            placeholder="Enter UTM content"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2">
                <input
                    type="checkbox"
                    checked={config.overrideFrom || false}
                    onChange={(e) => onUpdate('overrideFrom', e.target.checked)}
                    className="h-4 w-4 rounded text-blue-600"
                />
                <span className="text-sm text-gray-700">Override From Name, From Email and Reply To Email</span>
            </label>

            {config.overrideFrom && (
                <div className="space-y-3 rounded-lg border bg-gray-50 p-3">
                    <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                        <label className="text-sm font-medium text-gray-700">From Name</label>
                        <input
                            type="text"
                            value={config.fromName || ''}
                            onChange={(e) => onUpdate('fromName', e.target.value)}
                            placeholder="Your Company"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                        <label className="text-sm font-medium text-gray-700">From Email</label>
                        <input
                            type="email"
                            value={config.fromEmail || ''}
                            onChange={(e) => onUpdate('fromEmail', e.target.value)}
                            placeholder="hello@example.com"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                        <label className="text-sm font-medium text-gray-700">Reply To Email</label>
                        <input
                            type="email"
                            value={config.replyToEmail || ''}
                            onChange={(e) => onUpdate('replyToEmail', e.target.value)}
                            placeholder="reply@example.com"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>
            )}

            {showTemplateSelector && (
                <EmailTemplateSelectorModal
                    onSelect={handleTemplateSelect}
                    onClose={() => setShowTemplateSelector(false)}
                />
            )}

            {showSaveAsTemplate && (
                <SaveAsTemplateModal
                    content={config.htmlContent || ''}
                    designJson={config.designJson}
                    onSaved={() => setShowSaveAsTemplate(false)}
                    onClose={() => setShowSaveAsTemplate(false)}
                />
            )}

            {showPreview && (
                <EmailPreviewModal
                    htmlContent={config.htmlContent || ''}
                    subject={config.subject}
                    onClose={() => setShowPreview(false)}
                />
            )}

            {showVisualBuilder && (
                <MarketingEmailDesigner
                    initialDesign={config.designJson}
                    initialSubject={config.subject}
                    initialPreviewText={config.previewText}
                    onSave={handleVisualBuilderSave}
                    onCancel={() => setShowVisualBuilder(false)}
                />
            )}

            {showPreflightModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-xs">
                    <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl">
                        <h3 className="text-lg font-semibold text-gray-900">Preflight Check</h3>
                        <p className="mt-1 text-sm text-gray-500">We found a few things to review before preview/testing.</p>

                        <div className="mt-4 space-y-3">
                            {groupedIssues.blocking.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Blocking issues</p>
                                    {groupedIssues.blocking.map((issue) => (
                                        <div key={issue.id} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                            {issue.message}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {groupedIssues.warning.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Warnings</p>
                                    {groupedIssues.warning.map((issue) => (
                                        <div key={issue.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                            {issue.message}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowPreflightModal(false)}
                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Fix First
                            </button>
                            <button
                                type="button"
                                disabled={hasBlockingIssues}
                                onClick={() => {
                                    setShowPreflightModal(false);
                                    setShowPreview(true);
                                }}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Continue to Preview
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showMergeTagModal && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-xs">
                    <div className="w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="flex items-center gap-4 border-b border-gray-200 px-5 py-4">
                            <h3 className="text-2xl font-medium text-gray-900">Merge Tags</h3>
                            <div className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-lg border border-gray-300 px-3 py-2">
                                <Search className="h-4 w-4 text-gray-400" />
                                <input
                                    value={mergeTagSearch}
                                    onChange={(e) => setMergeTagSearch(e.target.value)}
                                    placeholder="Search by name"
                                    className="w-full border-0 text-sm text-gray-700 outline-none"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowMergeTagModal(false)}
                                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="Close merge tag modal"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="grid h-[520px] grid-cols-[180px_1fr]">
                            <div className="border-r border-gray-200 bg-gray-50">
                                {MERGE_TAG_CATEGORIES.map((category) => (
                                    <button
                                        key={category.id}
                                        type="button"
                                        onClick={() => setMergeTagCategory(category.id)}
                                        className={`flex w-full items-center px-4 py-3 text-left text-sm ${
                                            mergeTagCategory === category.id
                                                ? 'bg-white font-medium text-gray-900'
                                                : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                    >
                                        {category.label}
                                    </button>
                                ))}
                            </div>

                            <div className="overflow-y-auto">
                                {visibleMergeTags.length === 0 ? (
                                    <div className="p-8 text-sm text-gray-500">No merge tags found for that search.</div>
                                ) : (
                                    visibleMergeTags.map((tag) => (
                                        <div key={tag.value} className="flex items-center gap-4 border-b border-gray-100 px-6 py-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-gray-900">{tag.label}</p>
                                            </div>
                                            <code className="min-w-[220px] text-xs text-gray-500">{tag.value}</code>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    insertMergeTag(activeMergeTagField, tag.value, getFieldRef(activeMergeTagField));
                                                    setShowMergeTagModal(false);
                                                }}
                                                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                                title="Insert merge tag"
                                            >
                                                <Copy className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
