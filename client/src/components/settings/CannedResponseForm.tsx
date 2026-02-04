/**
 * CannedResponseForm
 * 
 * Form for creating/editing canned responses with rich text support.
 */
import React from 'react';
import { Plus, Save, X, Zap } from 'lucide-react';
import { RichTextEditor } from '../common/RichTextEditor';
import { CannedResponseLabel } from './CannedResponseLabelManager';

interface FormData {
    shortcut: string;
    content: string;
    labelId: string;
}

interface CannedResponseFormProps {
    formData: FormData;
    labels: CannedResponseLabel[];
    editingId: string | null;
    onFormChange: (data: FormData) => void;
    onSave: () => void;
    onCancel: () => void;
}

export function CannedResponseForm({
    formData, labels, editingId, onFormChange, onSave, onCancel
}: CannedResponseFormProps) {
    return (
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
                {editingId ? 'Edit Response' : 'Add New Response'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Shortcut</label>
                    <input
                        type="text"
                        placeholder="e.g. hi, refund, shipping"
                        value={formData.shortcut}
                        onChange={(e) => onFormChange({ ...formData, shortcut: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Label</label>
                    <select
                        value={formData.labelId}
                        onChange={(e) => onFormChange({ ...formData, labelId: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                        <option value="">No Label</option>
                        {labels.map(label => (
                            <option key={label.id} value={label.id}>{label.name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-end gap-2">
                    <button
                        onClick={onSave}
                        disabled={!formData.shortcut.trim() || !formData.content.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {editingId ? <Save size={14} /> : <Plus size={14} />}
                        {editingId ? 'Save' : 'Add'}
                    </button>
                    {editingId && (
                        <button onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
                            <X size={14} />Cancel
                        </button>
                    )}
                </div>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Content (Rich Text)</label>
                <RichTextEditor
                    value={formData.content}
                    onChange={(val) => onFormChange({ ...formData, content: val })}
                    placeholder="Type your response here... Use {{customer.firstName}} for placeholders."
                    variant="standard"
                />
            </div>
            <MergeTagsHelp />
        </div>
    );
}

function MergeTagsHelp() {
    return (
        <div className="mt-3 bg-amber-50 rounded-lg p-3 border border-amber-200">
            <div className="flex items-start gap-2">
                <Zap size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs">
                    <p className="font-medium text-amber-800 mb-2">Available Merge Tags</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-amber-700">
                        <div><code className="bg-amber-100 px-1 rounded">{'{{customer.firstName}}'}</code> Customer's first name</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{customer.lastName}}'}</code> Last name</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{customer.name}}'}</code> Full name</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{customer.email}}'}</code> Email address</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{customer.greeting}}'}</code> "Hi John" or "Hi there"</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{customer.ordersCount}}'}</code> Number of orders</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{customer.totalSpent}}'}</code> Lifetime spend</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{agent.firstName}}'}</code> Your first name</div>
                        <div><code className="bg-amber-100 px-1 rounded">{'{{agent.fullName}}'}</code> Your full name</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
