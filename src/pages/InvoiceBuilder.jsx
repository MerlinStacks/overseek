import React, { useState, useRef, useEffect } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { toast, Toaster } from 'sonner';
import { useSettings } from '../context/SettingsContext';
import {
    Layout, Type, Image as ImageIcon, DollarSign, FileText,
    Trash2, GripVertical, Plus, AlignLeft, AlignCenter, AlignRight,
    GripHorizontal, MapPin, Search, Info, Printer
} from 'lucide-react';
import { InvoiceBlockRenderer } from '../components/InvoiceRenderer';
import { PREVIEW_DATA as SHARED_PREVIEW_DATA } from '../components/InvoiceRenderer'; // We might not be able to export this easily if not exported
import './InvoiceBuilder.css';

// --- Data Constants ---
const TYPE_LABELS = {
    header: 'Header Title',
    text: 'Text Content',
    logo: 'Logo Image',
    line_items: 'Line Items Table',
    totals: 'Totals & Summary',
    billing_address: 'Billing Address',
    shipping_address: 'Shipping Address',
    order_info: 'Order Info',
    spacer: 'Spacer'
};

const TOOLS = [
    { type: 'header', label: 'Header', icon: Type },
    { type: 'text', label: 'Text Block', icon: FileText },
    { type: 'billing_address', label: 'Billing Address', icon: MapPin },
    { type: 'shipping_address', label: 'Shipping Address', icon: MapPin },
    { type: 'logo', label: 'Logo', icon: ImageIcon },
    { type: 'line_items', label: 'Line Items', icon: Layout },
    { type: 'totals', label: 'Totals', icon: DollarSign },
    { type: 'order_info', label: 'Order Info', icon: Info },
    { type: 'spacer', label: 'Spacer', icon: GripHorizontal },
];

import { GOOGLE_FONTS_LIST } from '../data/googleFontsList';

const createFontLink = (fontName) => {
    if (!fontName) return null;
    const linkId = `font-${fontName.replace(/\s+/g, '-')}`;
    if (document.getElementById(linkId)) return;

    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@400;700&display=swap`;
    document.head.appendChild(link);
};

const FontPicker = ({ selectedFont, onChange }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [displayLimit, setDisplayLimit] = useState(20);
    const wrapperRef = useRef(null);
    const listRef = useRef(null);

    // Initial load for selected font
    useEffect(() => {
        if (selectedFont) {
            // Extract font name from value like "Inter, sans-serif"
            const name = selectedFont.split(',')[0].replace(/['"]/g, '');
            createFontLink(name);
        }
    }, [selectedFont]);

    const filteredFonts = GOOGLE_FONTS_LIST.filter(f =>
        f.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const displayedFonts = filteredFonts.slice(0, displayLimit);

    const handleScroll = (e) => {
        const { scrollTop, clientHeight, scrollHeight } = e.target;
        if (scrollHeight - scrollTop <= clientHeight + 50) {
            setDisplayLimit(prev => Math.min(prev + 20, filteredFonts.length));
        }
    };

    // Lazy load fonts for visible items
    useEffect(() => {
        if (isOpen) {
            displayedFonts.forEach(font => createFontLink(font));
        }
    }, [isOpen, displayedFonts]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Reset limit on search
    useEffect(() => {
        setDisplayLimit(20);
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [searchTerm]);

    const getFontValue = (name) => {
        // Simple heuristic for generic category
        const serifFonts = ['Merriweather', 'Playfair Display', 'Lora', 'PT Serif', 'Noto Serif', 'Libre Baskerville'];
        const scriptFonts = ['Dancing Script', 'Pacifico', 'Lobster', 'Caveat', 'Satisfy'];
        const monoFonts = ['Roboto Mono', 'Inconsolata', 'Source Code Pro', 'Fira Mono'];

        if (serifFonts.includes(name)) return `"${name}", serif`;
        if (scriptFonts.includes(name)) return `"${name}", cursive`;
        if (monoFonts.includes(name)) return `"${name}", monospace`;
        return `"${name}", sans-serif`;
    };

    const currentFontName = selectedFont ? selectedFont.split(',')[0].replace(/['"]/g, '') : 'Default';

    return (
        <div className="font-picker-wrapper" ref={wrapperRef} style={{ position: 'relative' }}>
            <div
                className="font-picker-trigger prop-select"
                onClick={() => setIsOpen(!isOpen)}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
                <span style={{ fontFamily: selectedFont || 'inherit' }}>
                    {currentFontName}
                </span>
                <span style={{ fontSize: '0.7em', color: '#94a3b8' }}>▼</span>
            </div>

            {isOpen && (
                <div className="font-picker-dropdown">
                    <input
                        type="text"
                        placeholder="Search all Google Fonts..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="font-picker-search"
                        autoFocus
                    />
                    <div className="font-picker-list" onScroll={handleScroll} ref={listRef}>
                        <div
                            className={`font-picker-item ${!selectedFont ? 'selected' : ''}`}
                            onClick={() => { onChange(''); setIsOpen(false); }}
                        >
                            Default (Inherit)
                        </div>
                        {displayedFonts.map(font => (
                            <div
                                key={font}
                                className={`font-picker-item ${currentFontName === font ? 'selected' : ''}`}
                                onClick={() => { onChange(getFontValue(font)); setIsOpen(false); }}
                                style={{ fontFamily: `"${font}"`, fontSize: '1.2em' }}
                                title={font}
                            >
                                {font}
                            </div>
                        ))}
                    </div>
                    {filteredFonts.length > displayLimit && (
                        <div style={{ padding: '8px', textAlign: 'center', fontSize: '0.8rem', opacity: 0.5 }}>
                            Scroll for more...
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const PREVIEW_DATA = {
    line_items: [
        { id: 1, name: 'Web Design Service', quantity: 1, subtotal: '1500.00', price: '1500.00' },
        { id: 2, name: 'Hosting (1 Year)', quantity: 1, subtotal: '200.00', price: '200.00' },
    ],
    total: '1700.00',
    currency: '$',
    order_number: '1001',
    order_date: '2024-10-24',
    payment_method: 'Credit Card (Visa)',
    billing: { name: 'John Doe', address: '123 Main St', city: 'Sydney', state: 'NSW', zip: '2000', country: 'Australia', first_name: 'John', last_name: 'Doe' },
    shipping: { name: 'Jane Doe', address: '456 Tech Park', city: 'Melbourne', state: 'VIC', zip: '3000', country: 'Australia', first_name: 'Jane', last_name: 'Doe' }
};

const DEFAULT_ROWS = [
    {
        id: 'row-header',
        columns: [
            { id: 'col-header-1', width: 60, blocks: [{ id: 'b1', type: 'header', content: 'INVOICE', align: 'left', fontSize: 32 }] },
            { id: 'col-header-2', width: 40, blocks: [{ id: 'b2', type: 'text', content: 'Invoice #1001\nDate: 2024-10-24', align: 'right', fontSize: 14 }] }
        ]
    },
    {
        id: 'row-billing',
        columns: [
            { id: 'col-bill-1', width: 50, blocks: [{ id: 'b3', type: 'text', content: 'Bill To:\nJohn Doe\n123 Main St', align: 'left', fontSize: 14 }] },
            { id: 'col-bill-2', width: 50, blocks: [] }
        ]
    },
    {
        id: 'row-items',
        columns: [
            { id: 'col-items-1', width: 100, blocks: [{ id: 'b4', type: 'line_items' }] }
        ]
    },
    {
        id: 'row-totals',
        columns: [
            { id: 'col-totals-1', width: 60, blocks: [] },
            { id: 'col-totals-2', width: 40, blocks: [{ id: 'b5', type: 'totals', align: 'right' }] }
        ]
    }
];

// --- Sub Components ---

const BlockRenderer = ({ block }) => {
    // We pass PREVIEW_DATA explicitly here to maintain the preview functionality
    // The imported InvoiceBlockRenderer handles the actual rendering
    return <InvoiceBlockRenderer block={block} data={PREVIEW_DATA} />;
};

const InvoiceRowItem = ({ row, selectedRowId, onSelectRow, deleteRow, addColumn, handleDrop, selectedBlockId, onSelectBlock, startResize }) => {
    const dragControls = useDragControls();

    return (
        <Reorder.Item
            value={row}
            id={row.id}
            dragListener={false}
            dragControls={dragControls}
            className={`invoice-row ${selectedRowId === row.id ? 'selected' : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelectRow(row.id); }}
        >
            <div className="row-actions">
                <div className="row-handle" onPointerDown={(e) => dragControls.start(e)} style={{ touchAction: 'none' }}>
                    <GripVertical size={16} />
                </div>
                <div className="row-delete" onClick={() => deleteRow(row.id)} title="Delete Row"><Trash2 size={16} /></div>
            </div>

            <div className="col-add-btn" onClick={() => addColumn(row.id)} title="Add Column"><Plus size={14} /></div>

            {row.columns.map((col, idx) => (
                <div
                    key={col.id}
                    className="invoice-col"
                    style={{ width: `${col.width}%` }}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                    onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
                    onDrop={e => { e.currentTarget.classList.remove('drag-over'); handleDrop(e, row.id, col.id); }}
                >
                    {col.blocks.map(block => (
                        <div
                            key={block.id}
                            className={`invoice-block ${selectedBlockId === block.id ? 'selected' : ''}`}
                            onClick={(e) => { e.stopPropagation(); onSelectBlock(block.id, row.id); }}
                        >
                            <BlockRenderer block={block} />
                        </div>
                    ))}
                    {idx < row.columns.length - 1 && (
                        <div className="col-resize-handle" onMouseDown={(e) => startResize(e, row.id, idx)} />
                    )}
                </div>
            ))}
        </Reorder.Item>
    );
};

// --- Main Component ---
export default function InvoiceBuilder() {
    const { settings, updateSettings } = useSettings();
    const [rows, setRows] = useState(DEFAULT_ROWS);
    const [footerText, setFooterText] = useState("Thank you for your business!");
    const [selectedBlockId, setSelectedBlockId] = useState(null);

    // Load saved settings
    useEffect(() => {
        if (settings?.invoiceLayout) {
            try {
                setRows(JSON.parse(settings.invoiceLayout));
            } catch (e) {
                console.error("Failed to parse invoice layout", e);
            }
        }
        if (settings?.footerText) {
            setFooterText(settings.footerText);
        }
    }, [settings]);
    const [selectedRowId, setSelectedRowId] = useState(null);
    const [scale, setScale] = useState(1);
    const canvasWrapperRef = useRef(null);
    const resizingRef = useRef(null);

    // Auto-scale logic
    useEffect(() => {
        const calculateScale = () => {
            if (canvasWrapperRef.current) {
                const wrapper = canvasWrapperRef.current;
                const availableHeight = wrapper.clientHeight - 80; // Padding
                const availableWidth = wrapper.clientWidth - 80;

                // A4 Dimensions: 794px x 1123px (approx)
                const A4_WIDTH = 794;
                const A4_HEIGHT = 1123;

                const scaleW = availableWidth / A4_WIDTH;
                const scaleH = availableHeight / A4_HEIGHT;

                let newScale = Math.min(scaleW, scaleH);
                if (newScale > 1.2) newScale = 1.2;
                if (newScale < 0.3) newScale = 0.3;

                setScale(newScale);
            }
        };

        calculateScale();
        const observer = new ResizeObserver(calculateScale);
        if (canvasWrapperRef.current) observer.observe(canvasWrapperRef.current);
        return () => observer.disconnect();
    }, []);

    // Logic Helpers
    const findBlock = (id) => {
        for (const row of rows) {
            for (const col of row.columns) {
                const block = col.blocks.find(b => b.id === id);
                if (block) return { block, col, row };
            }
        }
        return null;
    };

    const updateBlock = (id, updates) => {
        setRows(prev => prev.map(row => ({
            ...row,
            columns: row.columns.map(col => ({
                ...col,
                blocks: col.blocks.map(b => b.id === id ? { ...b, ...updates } : b)
            }))
        })));
    };

    const deleteBlock = (id) => {
        setRows(prev => prev.map(row => ({
            ...row,
            columns: row.columns.map(col => ({
                ...col,
                blocks: col.blocks.filter(b => b.id !== id)
            }))
        })));
        setSelectedBlockId(null);
    };

    const handleDragStart = (e, type) => {
        e.dataTransfer.setData('toolType', type);
    };

    const handleDrop = (e, rowId, colId) => {
        e.preventDefault();
        const toolType = e.dataTransfer.getData('toolType');
        if (!toolType) return;

        const newBlock = {
            id: Date.now().toString(),
            type: toolType,
            content: toolType === 'header' ? 'HEADER' : toolType === 'text' ? 'New Text...' : '',
            align: 'left',
            fontSize: toolType === 'header' ? 24 : 14,
            height: 20
        };

        setRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            return {
                ...row,
                columns: row.columns.map(col => {
                    if (col.id !== colId) return col;
                    return { ...col, blocks: [...col.blocks, newBlock] };
                })
            };
        }));
    };

    const addRow = () => {
        const newRow = {
            id: `row-${Date.now()}`,
            columns: [{ id: `col-${Date.now()}`, width: 100, blocks: [] }]
        };
        setRows([...rows, newRow]);
    };

    const deleteRow = (id) => setRows(rows.filter(r => r.id !== id));

    const addColumn = (rowId) => {
        setRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const currentCols = row.columns.length;
            const newWidth = 100 / (currentCols + 1);
            const newCols = row.columns.map(c => ({ ...c, width: newWidth }));
            newCols.push({ id: `col-${Date.now()}`, width: newWidth, blocks: [] });
            return { ...row, columns: newCols };
        }));
    };

    // Resize Handlers
    const startResize = (e, rowId, colIndex) => {
        e.preventDefault();
        e.stopPropagation();
        resizingRef.current = {
            rowId,
            colIndex,
            startX: e.clientX,
            startWidths: rows.find(r => r.id === rowId).columns.map(c => c.width)
        };
        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeUp);
    };

    const handleResizeMove = (e) => {
        if (!resizingRef.current) return;
        const { rowId, colIndex, startX, startWidths } = resizingRef.current;
        const rowEl = document.getElementById(rowId);
        if (!rowEl) return;

        const deltaPercent = ((e.clientX - startX) / rowEl.offsetWidth) * 100;
        const leftWidth = startWidths[colIndex] + deltaPercent;
        const rightWidth = startWidths[colIndex + 1] - deltaPercent;

        if (leftWidth < 5 || rightWidth < 5) return;

        setRows(prev => prev.map(row => {
            if (row.id !== rowId) return row;
            const newCols = [...row.columns];
            newCols[colIndex] = { ...newCols[colIndex], width: leftWidth };
            newCols[colIndex + 1] = { ...newCols[colIndex + 1], width: rightWidth };
            return { ...row, columns: newCols };
        }));
    };

    const handleResizeUp = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeUp);
    };

    const handleImageUpload = (e, blockId) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => updateBlock(blockId, { src: e.target.result });
            reader.readAsDataURL(file);
        }
    };

    const saveInvoice = async () => {
        try {
            await updateSettings({
                invoiceLayout: JSON.stringify(rows),
                footerText: footerText
            });
            toast.success("Invoice Saved Successfully!");
        } catch (error) {
            console.error(error);
            toast.error("Failed to save invoice settings.");
        }
    };

    const handlePrint = () => {
        window.print();
    };


    const selectedBlockInfo = selectedBlockId ? findBlock(selectedBlockId) : null;
    const selectedBlock = selectedBlockInfo?.block;

    return (
        <div className="invoice-builder-container">
            <Toaster position="top-right" theme="dark" />

            {/* Sidebar */}
            <div className="builder-sidebar">
                <div style={{ display: 'flex', gap: '10px', padding: '15px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={addRow}><Plus size={16} /> Row</button>
                    <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.05)' }} onClick={saveInvoice}><Save size={16} /></button>
                    <button className="btn" style={{ flex: 1, background: 'rgba(255,255,255,0.05)' }} onClick={handlePrint} title="Print / Print to PDF"><Printer size={16} /></button>
                </div>
                <div className="sidebar-tools">
                    {TOOLS.map(tool => (
                        <div key={tool.type} className="tool-item" draggable onDragStart={(e) => handleDragStart(e, tool.type)}>
                            <tool.icon size={24} />
                            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{tool.label}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Canvas */}
            <div className="builder-canvas-wrapper" ref={canvasWrapperRef} onClick={() => { setSelectedBlockId(null); setSelectedRowId(null); }}>
                <div
                    className="invoice-paper"
                    id="invoice-paper"
                    style={{
                        transform: `scale(${scale})`,
                        transformOrigin: 'top center',
                        marginBottom: `${(1123 * scale) - 1123}px`
                    }}
                >
                    <Reorder.Group axis="y" values={rows} onReorder={setRows}>
                        {rows.map((row) => (
                            <InvoiceRowItem
                                key={row.id}
                                row={row}
                                selectedRowId={selectedRowId}
                                onSelectRow={(id) => { setSelectedRowId(id); setSelectedBlockId(null); }}
                                deleteRow={deleteRow}
                                addColumn={addColumn}
                                handleDrop={handleDrop}
                                selectedBlockId={selectedBlockId}
                                onSelectBlock={(bId, rId) => { setSelectedBlockId(bId); setSelectedRowId(rId); }}
                                startResize={startResize}
                            />
                        ))}
                    </Reorder.Group>

                    {rows.length === 0 && (
                        <div className="invoice-flex-center">
                            <Layout size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                            <p>Drag tools here or add a row to start.</p>
                        </div>
                    )}

                    {/* Footer Section */}
                    <div
                        className={`invoice-footer ${selectedBlockId === 'footer' ? 'selected' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSelectedBlockId('footer'); setSelectedRowId(null); }}
                        style={{
                            marginTop: 'auto',
                            padding: '20px',
                            borderTop: '2px solid #e2e8f0',
                            textAlign: 'center',
                            fontSize: '12px',
                            color: '#64748b',
                            cursor: 'pointer',
                            minHeight: '40px'
                        }}
                    >
                        {footerText || <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Click to edit footer...</span>}
                    </div>
                </div>
            </div>

            {/* Properties Panel */}
            <div className="properties-panel">
                <div className="props-header">Properties</div>
                <div className="props-content">
                    {selectedBlock ? (
                        <>
                            <div className="prop-section-info">
                                <div className="prop-section-label">Selected Element</div>
                                <div className="prop-section-value">
                                    {selectedBlock.type === 'header' && <Type size={20} />}
                                    {selectedBlock.type === 'text' && <FileText size={20} />}
                                    {TYPE_LABELS[selectedBlock.type] || selectedBlock.type}
                                </div>
                            </div>

                            <div className="prop-group">
                                <label className="prop-label">Alignment</label>
                                <div className="prop-controls-row">
                                    {['left', 'center', 'right'].map(a => (
                                        <button
                                            key={a}
                                            className={`btn-icon ${selectedBlock.align === a ? 'active' : ''}`}
                                            onClick={() => updateBlock(selectedBlock.id, { align: a })}
                                        >
                                            {a === 'left' && <AlignLeft size={16} />}
                                            {a === 'center' && <AlignCenter size={16} />}
                                            {a === 'right' && <AlignRight size={16} />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {['header', 'text', 'billing_address', 'shipping_address', 'totals', 'order_info'].includes(selectedBlock.type) && (
                                <div className="prop-group">
                                    <label className="prop-label">Font Family</label>
                                    <FontPicker
                                        selectedFont={selectedBlock.fontFamily}
                                        onChange={(val) => updateBlock(selectedBlock.id, { fontFamily: val })}
                                    />
                                </div>
                            )}

                            {['header', 'text', 'billing_address', 'shipping_address'].includes(selectedBlock.type) && (
                                <div className="prop-group">
                                    <label className="prop-label">Content</label>
                                    <textarea
                                        className="prop-textarea"
                                        value={selectedBlock.content}
                                        onChange={e => updateBlock(selectedBlock.id, { content: e.target.value })}
                                        placeholder="Enter text..."
                                    />
                                </div>
                            )}

                            {['header', 'text', 'billing_address', 'shipping_address'].includes(selectedBlock.type) && (
                                <div className="prop-group">
                                    <label className="prop-label">Font Size (px)</label>
                                    <input
                                        type="number"
                                        className="prop-input"
                                        value={selectedBlock.fontSize}
                                        onChange={e => updateBlock(selectedBlock.id, { fontSize: parseInt(e.target.value) })}
                                    />
                                </div>
                            )}

                            {selectedBlock.type === 'spacer' && (
                                <div className="prop-group">
                                    <label className="prop-label">Height (px)</label>
                                    <input
                                        type="number"
                                        className="prop-input"
                                        value={selectedBlock.height}
                                        onChange={e => updateBlock(selectedBlock.id, { height: parseInt(e.target.value) })}
                                    />
                                </div>
                            )}

                            {selectedBlock.type === 'logo' && (
                                <div className="prop-group">
                                    <label className="prop-label">Logo Image</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <input
                                            type="text"
                                            placeholder="Image URL..."
                                            className="prop-input"
                                            value={selectedBlock.src || ''}
                                            onChange={e => updateBlock(selectedBlock.id, { src: e.target.value })}
                                        />
                                        <div className="custom-file-upload">
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => handleImageUpload(e, selectedBlock.id)}
                                            />
                                            <ImageIcon size={24} />
                                            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Click to Upload Logo</span>
                                            <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Supports JPG, PNG</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                <button className="btn btn-danger" onClick={() => deleteBlock(selectedBlock.id)}>
                                    <Trash2 size={16} /> Delete Block
                                </button>
                            </div>
                        </>
                    ) : selectedBlockId === 'footer' ? (
                        <>
                            <div className="prop-section-info">
                                <div className="prop-section-label">Selected Element</div>
                                <div className="prop-section-value">
                                    <FileText size={20} />
                                    Footer
                                </div>
                            </div>
                            <div className="prop-group">
                                <label className="prop-label">Footer Text</label>
                                <textarea
                                    className="prop-textarea"
                                    value={footerText}
                                    onChange={e => setFooterText(e.target.value)}
                                    placeholder="Enter footer text..."
                                    rows={4}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="empty-state">
                            <div className="empty-icon-circle">
                                <FileText size={32} style={{ opacity: 0.3 }} />
                            </div>
                            <div style={{ fontWeight: 600, color: 'white', marginBottom: '4px' }}>No Element Selected</div>
                            <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>Select an element or the footer to edit properties.</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
