/**
 * SendEmailConfig - Full configuration panel for Send Email action
 * Includes visual builder, rich text, raw HTML modes, template management, and preview
 */
import { useState } from 'react';
import { RichTextEditor } from '../common/RichTextEditor';
import { EmailDesignEditor } from './EmailDesignEditor';
import { EmailTemplateSelectorModal } from './flow/EmailTemplateSelectorModal';
import { SaveAsTemplateModal } from './flow/SaveAsTemplateModal';
import { EmailPreviewModal } from './flow/EmailPreviewModal';
import type { EmailTemplate } from './flow/EmailTemplateSelectorModal';

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
}

export function SendEmailConfig({ config, onUpdate }: SendEmailConfigProps) {
    const [showTemplateSelector, setShowTemplateSelector] = useState(false);
    const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showVisualBuilder, setShowVisualBuilder] = useState(false);

    const templateType = config.templateType || 'visual';
    const emailCategory = config.emailCategory || (config.isTransactional ? 'TRANSACTIONAL' : 'MARKETING');

    const handleTemplateSelect = (template: EmailTemplate) => {
        onUpdate('htmlContent', template.content);
        onUpdate('designJson', template.designJson);
        if (template.subject) {
            onUpdate('subject', template.subject);
        }
        setShowTemplateSelector(false);
    };

    const handleVisualBuilderSave = (html: string, design: unknown) => {
        onUpdate('htmlContent', html);
        onUpdate('designJson', design);
        setShowVisualBuilder(false);
    };

    const handleRichTextChange = (value: string) => {
        onUpdate('htmlContent', value);
    };

    const handleHtmlChange = (value: string) => {
        onUpdate('htmlContent', value);
    };

    return (
        <div className="space-y-4">
            <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                    To <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <input
                        type="text"
                        value={config.to || '{{contact_email}}'}
                        onChange={(e) => onUpdate('to', e.target.value)}
                        placeholder="{{contact_email}}"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            const current = config.to || '';
                            onUpdate('to', current + '{{contact_email}}');
                        }}
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
                        type="text"
                        value={config.subject || ''}
                        onChange={(e) => onUpdate('subject', e.target.value)}
                        placeholder="Thank you {{contact_first_name}}, Order {{order_id}} has been Confirmed."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            const current = config.subject || '';
                            onUpdate('subject', current + '{{}}');
                        }}
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
                        type="text"
                        value={config.previewText || ''}
                        onChange={(e) => onUpdate('previewText', e.target.value)}
                        placeholder="This is your order confirmation email, let's double check everything."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        type="button"
                        onClick={() => {
                            const current = config.previewText || '';
                            onUpdate('previewText', current + '{{}}');
                        }}
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
                <div className="rounded-lg border-2 border-dashed border-purple-200 bg-purple-50 p-8 text-center">
                    <div className="mb-3 flex justify-center">
                        <div className="rounded-lg border border-purple-100 bg-white p-3 shadow-sm">
                            <svg className="h-8 w-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    onClick={() => setShowPreview(true)}
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
                <EmailDesignEditor
                    initialDesign={config.designJson}
                    onSave={handleVisualBuilderSave}
                    onCancel={() => setShowVisualBuilder(false)}
                />
            )}
        </div>
    );
}
