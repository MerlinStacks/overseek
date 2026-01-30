import { useState, useRef } from 'react';
import { X, Trash2, Type, Image as ImageIcon, Table, DollarSign, Settings, Upload, Loader2, CheckCircle, AlertCircle, User, LayoutTemplate, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Heading, FileText } from 'lucide-react';

interface DesignerPropertiesProps {
    items: any[];
    selectedId: string | null;
    onUpdateItem: (updates: any) => void;
    onDeleteItem: () => void;
    onClose: () => void;
    token?: string;
    accountId?: string;
}


const TYPE_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
    header: { icon: Heading, label: 'Header', color: 'text-slate-600 bg-slate-50' },
    text: { icon: Type, label: 'Text Block', color: 'text-blue-600 bg-blue-50' },
    image: { icon: ImageIcon, label: 'Image', color: 'text-purple-600 bg-purple-50' },
    order_details: { icon: FileText, label: 'Order Details', color: 'text-sky-600 bg-sky-50' },
    customer_details: { icon: User, label: 'Customer Details', color: 'text-indigo-600 bg-indigo-50' },
    order_table: { icon: Table, label: 'Order Items', color: 'text-emerald-600 bg-emerald-50' },
    totals: { icon: DollarSign, label: 'Totals', color: 'text-amber-600 bg-amber-50' },
    footer: { icon: LayoutTemplate, label: 'Footer', color: 'text-slate-600 bg-slate-50' }
};

/**
 * DesignerProperties - Property editor panel for selected canvas items.
 * Allows editing content and deleting items.
 */
export function DesignerProperties({ items, selectedId, onUpdateItem, onDeleteItem, onClose, token, accountId }: DesignerPropertiesProps) {
    const selectedItem = items.find(i => i.id === selectedId);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    if (!selectedItem) return null;

    const config = TYPE_CONFIG[selectedItem.type] || TYPE_CONFIG.text;
    const Icon = config.icon;

    /**
     * Handles image file upload to server.
     * Uses FormData for multipart upload to /api/invoices/templates/upload-image.
     */
    const handleImageUpload = async (file: File) => {
        if (!token || !accountId) {
            setUploadError('Authentication required');
            return;
        }

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
            setUploadError('Invalid file type. Use PNG, JPG, GIF, SVG, or WebP.');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setUploadError('File too large. Maximum size is 5MB.');
            return;
        }

        setIsUploading(true);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/invoices/templates/upload-image', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': accountId
                },
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }

            const result = await response.json();
            onUpdateItem({ content: result.url });
        } catch (error: any) {
            setUploadError(error.message || 'Failed to upload image');
        } finally {
            setIsUploading(false);
        }
    };

    const updateStyle = (key: string, value: any) => {
        const currentStyle = selectedItem.style || {};
        onUpdateItem({
            style: {
                ...currentStyle,
                [key]: value
            }
        });
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleImageUpload(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleImageUpload(file);
    };

    return (
        <div className="w-80 bg-white/90 backdrop-blur-xs border-l border-slate-200/60 flex flex-col shadow-xl z-20">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg ${config.color} flex items-center justify-center`}>
                        <Icon size={18} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-700 text-sm">{config.label}</h3>
                        <p className="text-xs text-slate-400">Edit properties</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Content Editor */}
            <div className="flex-1 overflow-y-auto p-5">
                <div className="space-y-5">
                    {/* Settings Section */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Settings size={14} className="text-slate-400" />
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Settings</span>
                        </div>

                        {selectedItem.type === 'header' && (
                            <div className="space-y-4">
                                {/* Logo Upload */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Logo Image</label>
                                    <div
                                        className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer
                                            ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-purple-400 hover:bg-purple-50/50'}
                                            ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
                                        onClick={() => fileInputRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                        onDragLeave={() => setIsDragging(false)}
                                        onDrop={async (e) => {
                                            e.preventDefault();
                                            setIsDragging(false);
                                            const file = e.dataTransfer.files?.[0];
                                            if (file && token && accountId) {
                                                setIsUploading(true);
                                                setUploadError(null);
                                                try {
                                                    const formData = new FormData();
                                                    formData.append('file', file);
                                                    const response = await fetch('/api/invoices/templates/upload-image', {
                                                        method: 'POST',
                                                        headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': accountId },
                                                        body: formData
                                                    });
                                                    if (response.ok) {
                                                        const result = await response.json();
                                                        onUpdateItem({ logo: result.url });
                                                    }
                                                } catch (err) {
                                                    setUploadError('Upload failed');
                                                } finally {
                                                    setIsUploading(false);
                                                }
                                            }
                                        }}
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                                            className="hidden"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (file && token && accountId) {
                                                    setIsUploading(true);
                                                    setUploadError(null);
                                                    try {
                                                        const formData = new FormData();
                                                        formData.append('file', file);
                                                        const response = await fetch('/api/invoices/templates/upload-image', {
                                                            method: 'POST',
                                                            headers: { 'Authorization': `Bearer ${token}`, 'X-Account-ID': accountId },
                                                            body: formData
                                                        });
                                                        if (response.ok) {
                                                            const result = await response.json();
                                                            onUpdateItem({ logo: result.url });
                                                        }
                                                    } catch (err) {
                                                        setUploadError('Upload failed');
                                                    } finally {
                                                        setIsUploading(false);
                                                    }
                                                }
                                            }}
                                        />
                                        {isUploading ? (
                                            <div className="flex flex-col items-center gap-1">
                                                <Loader2 size={20} className="text-purple-500 animate-spin" />
                                                <span className="text-xs text-purple-600">Uploading...</span>
                                            </div>
                                        ) : selectedItem.logo ? (
                                            <div className="flex flex-col items-center gap-2">
                                                <img src={selectedItem.logo} alt="Logo" className="w-20 h-16 object-contain rounded border border-slate-200" />
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onUpdateItem({ logo: '' }); }}
                                                    className="text-xs text-red-500 hover:text-red-600"
                                                >
                                                    Remove logo
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center gap-1">
                                                <Upload size={20} className="text-slate-400" />
                                                <span className="text-xs text-slate-500">Drop logo or click to upload</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Business Details */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Business Details</label>
                                    <textarea
                                        className="w-full text-sm border border-slate-200 rounded-xl shadow-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 p-3 resize-none transition-all"
                                        rows={5}
                                        placeholder={"Company Name\n123 Street Address\nCity, State ZIP\nABN: 12 345 678 901\nPh: (02) 1234 5678"}
                                        value={selectedItem.businessDetails || ''}
                                        onChange={e => onUpdateItem({ businessDetails: e.target.value })}
                                    />
                                </div>

                                {uploadError && (
                                    <div className="flex items-center gap-2 p-2 bg-red-50 rounded-lg border border-red-100">
                                        <AlertCircle size={14} className="text-red-500" />
                                        <span className="text-xs text-red-600">{uploadError}</span>
                                    </div>
                                )}

                                <p className="text-xs text-slate-400">
                                    Header with logo and business info appears on first page only.
                                </p>
                            </div>
                        )}

                        {selectedItem.type === 'text' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Content</label>
                                    <textarea
                                        className="w-full text-sm border border-slate-200 rounded-xl shadow-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 p-3 resize-none transition-all"
                                        rows={6}
                                        placeholder="Enter your text content..."
                                        value={selectedItem.content}
                                        onChange={e => onUpdateItem({ content: e.target.value })}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Typography</label>
                                    <div className="flex items-center gap-2 mb-2">
                                        <select
                                            className="flex-1 text-sm border border-slate-200 rounded-lg p-2"
                                            value={selectedItem.style?.fontSize || '14px'}
                                            onChange={(e) => updateStyle('fontSize', e.target.value)}
                                        >
                                            <option value="12px">Small (12px)</option>
                                            <option value="14px">Normal (14px)</option>
                                            <option value="16px">Medium (16px)</option>
                                            <option value="18px">Large (18px)</option>
                                            <option value="24px">Heading (24px)</option>
                                            <option value="32px">Title (32px)</option>
                                        </select>
                                    </div>
                                    <label className="flex items-center gap-2 mb-2 cursor-pointer group">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                checked={selectedItem.style?.autoFit !== false}
                                                onChange={(e) => updateStyle('autoFit', e.target.checked)}
                                                className="sr-only peer"
                                            />
                                            <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-indigo-500 transition-colors"></div>
                                            <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-transform"></div>
                                        </div>
                                        <span className="text-xs font-medium text-slate-600 group-hover:text-slate-800">Auto-fit text to block</span>
                                    </label>
                                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
                                        <button
                                            onClick={() => updateStyle('fontWeight', selectedItem.style?.fontWeight === 'bold' ? 'normal' : 'bold')}
                                            className={`p-1.5 rounded-md transition-all ${selectedItem.style?.fontWeight === 'bold' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                            title="Bold"
                                        >
                                            <Bold size={16} />
                                        </button>
                                        <button
                                            onClick={() => updateStyle('fontStyle', selectedItem.style?.fontStyle === 'italic' ? 'normal' : 'italic')}
                                            className={`p-1.5 rounded-md transition-all ${selectedItem.style?.fontStyle === 'italic' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                            title="Italic"
                                        >
                                            <Italic size={16} />
                                        </button>
                                        <div className="w-px h-4 bg-slate-300 mx-1" />
                                        <button
                                            onClick={() => updateStyle('textAlign', 'left')}
                                            className={`p-1.5 rounded-md transition-all ${(!selectedItem.style?.textAlign || selectedItem.style?.textAlign === 'left') ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                            title="Align Left"
                                        >
                                            <AlignLeft size={16} />
                                        </button>
                                        <button
                                            onClick={() => updateStyle('textAlign', 'center')}
                                            className={`p-1.5 rounded-md transition-all ${selectedItem.style?.textAlign === 'center' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                            title="Align Center"
                                        >
                                            <AlignCenter size={16} />
                                        </button>
                                        <button
                                            onClick={() => updateStyle('textAlign', 'right')}
                                            className={`p-1.5 rounded-md transition-all ${selectedItem.style?.textAlign === 'right' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                            title="Align Right"
                                        >
                                            <AlignRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {selectedItem.type === 'image' && (
                            <div className="space-y-4">
                                {/* Upload Zone */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Upload Image</label>
                                    <div
                                        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer
                                            ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-purple-400 hover:bg-purple-50/50'}
                                            ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
                                        onClick={() => fileInputRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                        onDragLeave={() => setIsDragging(false)}
                                        onDrop={handleDrop}
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp"
                                            className="hidden"
                                            onChange={handleFileSelect}
                                        />
                                        {isUploading ? (
                                            <div className="flex flex-col items-center gap-2">
                                                <Loader2 size={24} className="text-purple-500 animate-spin" />
                                                <span className="text-sm text-purple-600 font-medium">Uploading...</span>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center gap-2">
                                                <Upload size={24} className="text-slate-400" />
                                                <span className="text-sm text-slate-500">Drop image or click to upload</span>
                                                <span className="text-xs text-slate-400">PNG, JPG, GIF, SVG, WebP (max 5MB)</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Error Message */}
                                {uploadError && (
                                    <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl border border-red-100">
                                        <AlertCircle size={16} className="text-red-500 shrink-0" />
                                        <span className="text-xs text-red-600">{uploadError}</span>
                                    </div>
                                )}

                                {/* Success/Preview */}
                                {selectedItem.content && (
                                    <div className="p-3 bg-slate-50 rounded-xl">
                                        <div className="flex items-center gap-2 mb-2">
                                            <CheckCircle size={14} className="text-emerald-500" />
                                            <p className="text-xs font-medium text-slate-500">Image loaded</p>
                                        </div>
                                        <img
                                            src={selectedItem.content}
                                            alt="Preview"
                                            className="w-full h-24 object-contain rounded-lg bg-white border border-slate-200"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => onUpdateItem({ content: '' })}
                                            className="mt-2 text-xs text-red-500 hover:text-red-600 transition-colors"
                                        >
                                            Remove image
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {selectedItem.type === 'order_details' && (
                            <div className="p-4 bg-sky-50 rounded-xl border border-sky-100">
                                <p className="text-sm font-medium text-sky-700 mb-1">Order Information</p>
                                <p className="text-xs text-sky-600 leading-relaxed">
                                    Displays order number, date, and payment method. Data is pulled automatically from the selected order.
                                </p>
                            </div>
                        )}

                        {selectedItem.type === 'order_table' && (
                            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                                <p className="text-sm font-medium text-emerald-700 mb-1">Auto-Generated Table</p>
                                <p className="text-xs text-emerald-600 leading-relaxed">
                                    Displays order line items with product name, SKU, metadata, quantity, price, and total.
                                </p>
                            </div>
                        )}

                        {selectedItem.type === 'totals' && (
                            <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                                <p className="text-sm font-medium text-amber-700 mb-1">Auto-Calculated</p>
                                <p className="text-xs text-amber-600 leading-relaxed">
                                    Displays subtotal, shipping, tax, and grand total. Values are calculated from order data.
                                </p>
                            </div>
                        )}

                        {selectedItem.type === 'customer_details' && (
                            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                                <p className="text-sm font-medium text-indigo-700 mb-1">Customer Information</p>
                                <p className="text-xs text-indigo-600 leading-relaxed">
                                    Automatically displays the customer's billing and shipping details, including name, address, and contact info.
                                </p>
                            </div>
                        )}

                        {selectedItem.type === 'footer' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-2">Footer Content</label>
                                    <textarea
                                        className="w-full text-sm border border-slate-200 rounded-xl shadow-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 p-3 resize-none transition-all"
                                        rows={4}
                                        placeholder="Enter footer text (e.g., Thank you for your business)..."
                                        value={selectedItem.content}
                                        onChange={e => onUpdateItem({ content: e.target.value })}
                                    />
                                </div>
                                <p className="text-xs text-slate-400">
                                    This content will only appear on the last page of the invoice.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Delete Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                <button
                    onClick={onDeleteItem}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 text-sm font-semibold transition-all border border-red-100 hover:border-red-200"
                >
                    <Trash2 size={16} />
                    Delete Component
                </button>
            </div>
        </div>
    );
}
