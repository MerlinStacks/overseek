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

interface SendEmailConfigProps {
    config: any;
    onUpdate: (key: string, value: any) => void;
}

export function SendEmailConfig({ config, onUpdate }: SendEmailConfigProps) {
    // Modal states
    const [showTemplateSelector, setShowTemplateSelector] = useState(false);
    const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showVisualBuilder, setShowVisualBuilder] = useState(false);

    const templateType = config.templateType || 'visual';

    // Handle template selection
    const handleTemplateSelect = (template: any) => {
        onUpdate('htmlContent', template.content);
        onUpdate('designJson', template.designJson);
        if (template.subject) {
            onUpdate('subject', template.subject);
        }
        setShowTemplateSelector(false);
    };

    // Handle visual builder save
    const handleVisualBuilderSave = (html: string, design: any) => {
        onUpdate('htmlContent', html);
        onUpdate('designJson', design);
        setShowVisualBuilder(false);
    };

    // Handle rich text change
    const handleRichTextChange = (value: string) => {
        onUpdate('htmlContent', value);
    };

    // Handle raw HTML change
    const handleHtmlChange = (value: string) => {
        onUpdate('htmlContent', value);
    };

    return (
        <div className="space-y-4">
            {/* To Field */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    To <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <input
                        type="text"
                        value={config.to || '{{contact_email}}'}
                        onChange={(e) => onUpdate('to', e.target.value)}
                        placeholder="{{contact_email}}"
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
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
                <p className="text-xs text-gray-500 mt-1">Use comma separated values to send email to multiple users.</p>
            </div>

            {/* Subject Field */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Subject <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                    <input
                        type="text"
                        value={config.subject || ''}
                        onChange={(e) => onUpdate('subject', e.target.value)}
                        placeholder="Thank you {{contact_first_name}}, Order {{order_id}} has been Confirmed."
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
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

            {/* Preview Text Field */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Preview Text</label>
                <div className="relative">
                    <input
                        type="text"
                        value={config.previewText || ''}
                        onChange={(e) => onUpdate('previewText', e.target.value)}
                        placeholder="This is your order confirmation email, let's double check everything."
                        className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
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

            {/* Template Type Selection */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Template Type</label>
                <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            name="templateType"
                            value="visual"
                            checked={templateType === 'visual'}
                            onChange={() => onUpdate('templateType', 'visual')}
                            className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700">Visual Builder</span>
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded">New</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            name="templateType"
                            value="richtext"
                            checked={templateType === 'richtext'}
                            onChange={() => onUpdate('templateType', 'richtext')}
                            className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700">Rich Text</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            name="templateType"
                            value="html"
                            checked={templateType === 'html'}
                            onChange={() => onUpdate('templateType', 'html')}
                            className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-700">Raw HTML</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => setShowTemplateSelector(true)}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="3" y="3" width="7" height="7" rx="1" />
                            <rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" />
                            <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                        Templates
                    </button>
                </div>
            </div>

            {/* Content Area - Changes based on template type */}
            {templateType === 'visual' && (
                <div className="p-8 bg-purple-50 rounded-lg border-2 border-dashed border-purple-200 text-center">
                    <div className="flex justify-center mb-3">
                        <div className="p-3 bg-white rounded-lg shadow-sm border border-purple-100">
                            <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
                                <path d="M3 9h18M9 21V9" strokeWidth="1.5" />
                            </svg>
                        </div>
                    </div>
                    {config.htmlContent ? (
                        <p className="text-sm text-green-600 mb-3 font-medium">
                            ✓ Email content configured
                        </p>
                    ) : (
                        <p className="text-sm text-gray-600 mb-3">
                            Utilize our drag & drop builder to craft elegant email templates including WooCommerce Blocks.
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowVisualBuilder(true)}
                        className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                        {config.htmlContent ? 'Edit Design' : 'Edit'}
                    </button>
                </div>
            )}

            {templateType === 'richtext' && (
                <div className="border rounded-lg overflow-hidden">
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
                        placeholder="<html>\n  <body>\n    Your email HTML here...\n  </body>\n</html>"
                        rows={10}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setShowSaveAsTemplate(true)}
                    disabled={!config.htmlContent}
                    className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Save As Template
                </button>
                <button
                    type="button"
                    onClick={() => setShowPreview(true)}
                    disabled={!config.htmlContent}
                    className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Preview and Test
                </button>
            </div>

            {/* Mark as Transactional */}
            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={config.isTransactional || false}
                    onChange={(e) => onUpdate('isTransactional', e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600"
                />
                <span className="text-sm text-gray-700">Mark this email as Transactional</span>
                <span className="text-gray-400 cursor-help" title="Transactional emails are sent to all contacts, including unsubscribed">ⓘ</span>
            </label>

            {/* UTM Parameters Toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={config.appendUtm !== false}
                    onChange={(e) => onUpdate('appendUtm', e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600"
                />
                <span className="text-sm text-gray-700">Automatically append UTM parameters to email links</span>
            </label>

            {/* Campaign Fields */}
            <div className="space-y-3">
                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                    <label className="text-sm font-medium text-gray-700 pt-2">Campaign Source</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignSource || ''}
                            onChange={(e) => onUpdate('campaignSource', e.target.value)}
                            placeholder=""
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">Referrer: (e.g., google, newsletter)</p>
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                    <label className="text-sm font-medium text-gray-700 pt-2">Campaign Medium</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignMedium || 'Email'}
                            onChange={(e) => onUpdate('campaignMedium', e.target.value)}
                            placeholder="Email"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">Marketing medium: (e.g., CPC, banner, email)</p>
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                    <label className="text-sm font-medium text-gray-700 pt-2">Campaign Name</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignName || ''}
                            onChange={(e) => onUpdate('campaignName', e.target.value)}
                            placeholder=""
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">Product, promo code, or slogan (e.g., spring_sale)</p>
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                    <label className="text-sm font-medium text-gray-700 pt-2">Campaign Term</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignTerm || ''}
                            onChange={(e) => onUpdate('campaignTerm', e.target.value)}
                            placeholder="Enter UTM term"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                    <label className="text-sm font-medium text-gray-700 pt-2">Campaign Content</label>
                    <div>
                        <input
                            type="text"
                            value={config.campaignContent || ''}
                            onChange={(e) => onUpdate('campaignContent', e.target.value)}
                            placeholder="Enter UTM content"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                    </div>
                </div>
            </div>

            {/* Override From Settings */}
            <label className="flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={config.overrideFrom || false}
                    onChange={(e) => onUpdate('overrideFrom', e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600"
                />
                <span className="text-sm text-gray-700">Override From Name, From Email & Reply To Email</span>
            </label>

            {config.overrideFrom && (
                <div className="space-y-3 p-3 bg-gray-50 rounded-lg border">
                    <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
                        <label className="text-sm font-medium text-gray-700">From Name</label>
                        <input
                            type="text"
                            value={config.fromName || ''}
                            onChange={(e) => onUpdate('fromName', e.target.value)}
                            placeholder="Your Company"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
                        <label className="text-sm font-medium text-gray-700">From Email</label>
                        <input
                            type="email"
                            value={config.fromEmail || ''}
                            onChange={(e) => onUpdate('fromEmail', e.target.value)}
                            placeholder="hello@example.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                    </div>
                    <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
                        <label className="text-sm font-medium text-gray-700">Reply To Email</label>
                        <input
                            type="email"
                            value={config.replyToEmail || ''}
                            onChange={(e) => onUpdate('replyToEmail', e.target.value)}
                            placeholder="reply@example.com"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                    </div>
                </div>
            )}

            {/* Modals */}
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
