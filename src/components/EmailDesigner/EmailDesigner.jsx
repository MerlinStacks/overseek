import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import './EmailDesigner.css';
import {
    Layout, Image as ImageIcon, Type, MousePointer2,
    Move, Trash2, ArrowUp, ArrowDown, Code, Eye,
    Save, X, Palette, Link as LinkIcon,
    List, Square, Share2, Code2, Globe, Settings,
    ShoppingBag, Ticket, ClipboardList, Download, Search,
    Columns, PanelLeft, PanelRight, ArrowLeft,
    AlertTriangle, CheckCircle, Info
} from 'lucide-react';
import { validateEmail } from './EmailValidator';

const STRUCTURE_TOOLS = [
    { type: '1-col', label: '1 Column', icon: Square, layout: [1] },
    { type: '2-col', label: '2 Columns', icon: Columns, layout: [1, 1] },
    { type: '3-col', label: '3 Columns', icon: List, layout: [1, 1, 1] },
    { type: '1-2-col', label: '1:2 Column', icon: PanelRight, layout: [1, 2] },
    { type: '2-1-col', label: '2:1 Column', icon: PanelLeft, layout: [2, 1] },
];

const GENERAL_TOOLS = [
    { type: 'text', label: 'Text', icon: Type },
    { type: 'image', label: 'Image', icon: ImageIcon },
    { type: 'button', label: 'Button', icon: MousePointer2 },
    { type: 'divider', label: 'Divider', icon: Layout },
    { type: 'spacer', label: 'Spacer', icon: Move },
    { type: 'social', label: 'Social', icon: Share2 },
    { type: 'html', label: 'HTML', icon: Code2 },
    { type: 'footer', label: 'Footer', icon: LinkIcon },
];

const WOO_TOOLS = [
    { type: 'product', label: 'Product', icon: ShoppingBag },
    { type: 'coupon', label: 'Coupon', icon: Ticket },
    { type: 'order_summary', label: 'Order Summary', icon: ClipboardList },
    { type: 'downloads', label: 'Downloads', icon: Download },
];

const DEFAULT_STYLES = {
    text: {
        color: '#333333',
        fontSize: '16px',
        lineHeight: '1.5',
        textAlign: 'left',
        padding: '20px',
        backgroundColor: '#ffffff'
    },
    button: {
        backgroundColor: '#3b82f6',
        color: '#ffffff',
        padding: '12px 24px',
        borderRadius: '4px',
        textAlign: 'center',
        display: 'inline-block',
        textDecoration: 'none',
        fontSize: '16px',
        fontWeight: 'bold',
        width: 'auto',
        align: 'center'
    },
    container: {
        backgroundColor: '#f1f5f9',
        contentWidth: '600px',
        fontFamily: 'Arial, sans-serif'
    }
};

export default function EmailDesigner({ initialData, onClose, onSave }) {
    // Mode: 'visual' or 'code'
    const [mode, setMode] = useState('visual');
    const [activeTab, setActiveTab] = useState('blocks');
    const [blocks, setBlocks] = useState(initialData?.blocks || []);
    const [globalStyles, setGlobalStyles] = useState(initialData?.globalStyles || DEFAULT_STYLES.container);

    // Data Source
    const products = useLiveQuery(() => db.products.toArray()) || [];
    const templates = useLiveQuery(() => db.email_templates?.toArray()) || []; // Safe nav in case DB needs reload
    const [productSearch, setProductSearch] = useState('');
    const [templateName, setTemplateName] = useState('');

    // Selection
    const [selectedBlockId, setSelectedBlockId] = useState(null);
    const [draggedTool, setDraggedTool] = useState(null);

    // Code Editor State
    const [htmlCode, setHtmlCode] = useState('');

    // --- HISTORY ---
    const [history, setHistory] = useState([initialData?.blocks || []]);
    const [historyIndex, setHistoryIndex] = useState(0);

    const pushToHistory = (newBlocks) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newBlocks);
        // Limit history size if needed, e.g., 50 steps
        if (newHistory.length > 50) newHistory.shift();

        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setBlocks(newBlocks);
    };

    const undo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setBlocks(history[newIndex]);
        }
    };

    const redo = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setBlocks(history[newIndex]);
        }
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                undo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [history, historyIndex]);

    // --- HTML GENERATOR ---
    // --- HTML GENERATOR ---
    const renderBlockToHtml = (block) => {
        let content = '';
        const padding = block.styles?.padding || '20px';
        const bg = block.styles?.backgroundColor || '#ffffff';
        const align = block.styles?.textAlign || 'left';

        if (block.type === 'section') {
            const columns = block.columns || [];
            const layout = block.layout || '1-col';

            // Calculate widths
            // 1-col: 100%
            // 2-col: 50%, 50%
            // 3-col: 33.33%...
            // 1-2-col: 33.33%, 66.66%
            // 2-1-col: 66.66%, 33.33%

            let widths = ['100%'];
            if (layout === '2-col') widths = ['50%', '50%'];
            if (layout === '3-col') widths = ['33.33%', '33.33%', '33.33%'];
            if (layout === '1-2-col') widths = ['33.33%', '66.66%'];
            if (layout === '2-1-col') widths = ['66.66%', '33.33%'];

            const columnsHtml = columns.map((colBlocks, index) => {
                const width = widths[index] || '100%';
                const colContent = colBlocks.map(b => renderBlockToHtml(b)).join('');
                return `
                    <td width="${width}" valign="top" class="column-cell" style="padding: 0; vertical-align: top;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                            ${colContent}
                        </table>
                    </td>
                `;
            }).join('');

            return `
                <tr>
                    <td align="center" style="background-color: ${bg}; padding: ${padding};">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="table-layout: fixed;">
                            <tr>
                                ${columnsHtml}
                            </tr>
                        </table>
                    </td>
                </tr>
            `;
        }

        // Standard Blocks
        if (block.type === 'text') {
            content = `<div style="font-size: ${block.styles?.fontSize || '16px'}; color: ${block.styles?.color || '#333'}; line-height: ${block.styles?.lineHeight || '1.5'}; text-align: ${align};">${block.content?.text || 'Edit this text...'}</div>`;
        } else if (block.type === 'image') {
            const imgUrl = block.content?.url;
            const width = block.styles?.width || '100%';
            if (imgUrl) {
                content = `<img src="${imgUrl}" alt="${block.content?.alt || ''}" style="width: ${width}; max-width: 100%; height: auto; display: block; margin: 0 auto;" />`;
            } else {
                content = `<div style="width: ${width}; height: 200px; background-color: #f1f5f9; color: #94a3b8; text-align: center; line-height: 200px; border: 2px dashed #e2e8f0; margin: 0 auto;">Select Image</div>`;
            }
        } else if (block.type === 'button') {
            const btnBg = block.styles?.backgroundColor || '#3b82f6';
            const btnColor = block.styles?.color || '#ffffff';
            const btnAlign = block.styles?.align || 'center';
            const btnPadding = block.styles?.padding || '12px 24px';
            const btnRadius = block.styles?.borderRadius || '4px';

            content = `
                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                        <td align="${btnAlign}">
                            <a href="${block.content?.link || '#'}" style="background-color: ${btnBg}; color: ${btnColor}; padding: ${btnPadding}; border-radius: ${btnRadius}; text-decoration: none; display: inline-block; font-weight: bold; font-size: ${block.styles?.fontSize || '16px'};">${block.content?.text || 'Click Me'}</a>
                        </td>
                    </tr>
                </table>
            `;
        } else if (block.type === 'spacer') {
            const height = block.styles?.height || '20px';
            content = `<div style="height: ${height}; line-height: ${height}; font-size: 0;">&nbsp;</div>`;
        } else if (block.type === 'divider') {
            const color = block.styles?.color || '#e2e8f0';
            content = `<hr style="border: 0; border-top: 1px solid ${color}; margin: 0;" />`;
        } else if (block.type === 'footer') {
            content = `
                <div style="text-align: center; color: #94a3b8; font-size: 12px; padding: 20px;">
                    <p>${block.content?.companyName || 'Your Company'}</p>
                    <p>${block.content?.address || '123 Business St, City, Country'}</p>
                    <p><a href="{{unsubscribe_url}}" style="color: #94a3b8; text-decoration: underline;">Unsubscribe</a></p>
                </div>
            `;
        } else if (block.type === 'social') {
            const fb = block.content?.facebook;
            const tw = block.content?.twitter;
            const insta = block.content?.instagram;
            content = `<div style="text-align: center; padding: 10px;">
                ${fb ? `<a href="${fb}" style="margin: 0 10px; text-decoration: none; color: ${block.styles.color || '#333'}; font-weight: bold;">Facebook</a>` : ''}
                ${tw ? `<a href="${tw}" style="margin: 0 10px; text-decoration: none; color: ${block.styles.color || '#333'}; font-weight: bold;">Twitter</a>` : ''}
                ${insta ? `<a href="${insta}" style="margin: 0 10px; text-decoration: none; color: ${block.styles.color || '#333'}; font-weight: bold;">Instagram</a>` : ''}
            </div>`;
        } else if (block.type === 'html') {
            content = block.content.html || '<div style="background: #f8f8f8; padding: 10px; font-family: monospace;">Custom HTML Block</div>';
        } else if (block.type === 'product') {
            const img = block.content?.imageUrl;
            const name = block.content?.name || 'Product Name';
            const price = block.content?.price || '$99.00';
            const link = block.content?.link || '#';

            const imgHtml = img
                ? `<img src="${img}" alt="${name}" style="display: block; margin: 0 auto 15px; max-width: 100%; height: auto; border-radius: 4px;" width="200" />`
                : `<div style="width: 200px; height: 200px; background-color: #f1f5f9; margin: 0 auto 15px; text-align: center; line-height: 200px; color: #cbd5e1; border-radius: 4px;">No Image</div>`;

            content = `
                <div style="border: 1px solid #eee; padding: 15px; text-align: center; background: #fff; border-radius: 4px;">
                    ${imgHtml}
                    <h3 style="margin: 0 0 10px; font-size: 18px; color: #333;">${name}</h3>
                    <p style="margin: 0 0 15px; font-size: 16px; font-weight: bold; color: #333;">${price}</p>
                    <a href="${link}" style="display: inline-block; padding: 10px 20px; background: #1e293b; color: white; text-decoration: none; border-radius: 4px; font-size: 14px;">Buy Now</a>
                </div>
            `;
        } else if (block.type === 'order_summary') {
            content = `
                <table width="100%" border="0" cellspacing="0" cellpadding="10" style="border: 1px solid #eee; font-family: sans-serif;">
                    <tr style="background: #f8f8f8;">
                        <th align="left" style="color: #666; font-weight: 600; border-bottom: 1px solid #eee;">Product</th>
                        <th align="right" style="color: #666; font-weight: 600; border-bottom: 1px solid #eee;">Total</th>
                    </tr>
                    <tr>
                        <td style="border-bottom: 1px solid #eee; color: #333;">{{first_product_name}} x {{first_product_qty}}</td>
                        <td align="right" style="border-bottom: 1px solid #eee; color: #333;">{{first_product_price}}</td>
                    </tr>
                    <tr>
                         <td style="color: #999; font-size: 12px; font-style: italic;">(More items...)</td>
                         <td></td>
                    </tr>
                    <tr>
                        <td align="right" style="color: #333;"><strong>Total:</strong></td>
                        <td align="right" style="color: #333;"><strong>{{order_total}}</strong></td>
                    </tr>
                </table>
            `;
        }

        // Wrapper for Block (Table Row)
        return `
            <tr>
                <td align="center" style="background-color: ${bg}; padding: ${padding};">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td>${content}</td>
                        </tr>
                    </table>
                </td>
            </tr>
        `;
    };

    const generateHtml = (currentBlocks, styles) => {
        const bodyContent = currentBlocks.map(renderBlockToHtml).join('');

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Preview</title>
    <style>
        body { margin: 0; padding: 0; width: 100%; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table { border-collapse: collapse; }
        .wrapper-table { width: 100%; table-layout: fixed; }
        .main-table { margin: 0 auto; width: 100%; max-width: 600px; }
        
        @media screen and (max-width: 600px) {
            .main-table { width: 100% !important; }
            .column-cell { display: block !important; width: 100% !important; box-sizing: border-box; padding-bottom: 20px !important; }
            .mobile-padding { padding: 10px !important; }
            img { max-width: 100% !important; height: auto !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${styles.backgroundColor}; font-family: ${styles.fontFamily};">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" class="wrapper-table">
        <tr>
            <td align="center" style="padding: 20px 0;" class="mobile-padding">
                <table width="600" border="0" cellspacing="0" cellpadding="0" class="main-table" style="background-color: #ffffff; max-width: 600px; width: 100%;">
                    ${bodyContent}
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `.trim();
    };

    // Update HTML when blocks change
    useEffect(() => {
        if (mode === 'visual') {
            setHtmlCode(generateHtml(blocks, globalStyles));
        }
    }, [blocks, globalStyles, mode]);


    // --- ACTIONS ---
    // --- ACTIONS ---
    const addBlock = (type, index = null) => {
        // Check if it is a structure type
        const structureTool = STRUCTURE_TOOLS.find(t => t.type === type);

        const newBlock = {
            id: Date.now().toString(),
            type: structureTool ? 'section' : type,
            content: {},
            styles: {}
        };

        if (structureTool) {
            newBlock.layout = structureTool.type; // e.g., '2-col'
            // Initialize empty arrays for each column
            newBlock.columns = structureTool.layout.map(() => []);
            newBlock.styles = { padding: '0', backgroundColor: 'transparent' };
        } else if (type === 'text') {
            newBlock.content = { text: 'Welcome to our newsletter! Add your content here.' };
            newBlock.styles = { ...DEFAULT_STYLES.text };
        } else if (type === 'button') {
            newBlock.content = { text: 'Call to Action', link: '#' };
            newBlock.styles = { ...DEFAULT_STYLES.button };
        } else if (type === 'image') {
            newBlock.content = { url: '', alt: 'Image' };
            newBlock.styles = { width: '100%', padding: '0' };
        } else if (type === 'spacer') {
            newBlock.styles = { height: '30px', backgroundColor: 'transparent' };
        } else if (type === 'divider') {
            newBlock.styles = { color: '#e2e8f0', padding: '20px' };
        } else if (type === 'social') {
            newBlock.styles = { color: '#333333', padding: '10px' };
        } else if (type === 'html') {
            newBlock.content = { html: '<div>Insert Custom HTML Here</div>' };
            newBlock.styles = { padding: '0' };
        } else if (['product', 'order_summary', 'coupon', 'downloads'].includes(type)) {
            newBlock.styles = { padding: '10px' };
        }

        const newBlocks = [...blocks];
        if (index !== null) {
            newBlocks.splice(index, 0, newBlock);
        } else {
            newBlocks.push(newBlock);
        }
        pushToHistory(newBlocks);
        setSelectedBlockId(newBlock.id);
    };

    const addBlockToColumn = (sectionId, colIndex, toolType) => {
        const section = blocks.find(b => b.id === sectionId);
        if (!section || !section.columns) return;

        // Create the new block (reuse logic roughly, or simplify)
        // Simplification: We need the block creation logic extracted or duplicated.
        // Let's copy-paste the creation logic for now for safety/speed.
        const newBlock = {
            id: Date.now().toString(),
            type: toolType,
            content: {},
            styles: {}
        };
        // Defaults (Duplicate of above, refactor later if time permits)
        if (toolType === 'text') { newBlock.content = { text: 'Column Text' }; newBlock.styles = { ...DEFAULT_STYLES.text, padding: '10px' }; }
        else if (toolType === 'button') { newBlock.content = { text: 'Button', link: '#' }; newBlock.styles = { ...DEFAULT_STYLES.button }; }
        else if (toolType === 'image') { newBlock.content = { url: '', alt: 'Image' }; newBlock.styles = { width: '100%', padding: '0' }; }
        else if (toolType === 'product') { newBlock.styles = { padding: '10px' }; }
        else if (toolType === 'social') { newBlock.styles = { color: '#333333', padding: '10px' }; }
        // ... add others as needed

        const newColumns = [...section.columns];
        newColumns[colIndex] = [...newColumns[colIndex], newBlock];
        // We use updateBlock logic but need to push history manually since updateBlock (refactored below) might also do it?
        // Let's call updateBlock directly which we will refactor to use pushToHistory
        updateBlock(sectionId, { columns: newColumns });
    };

    const updateBlock = (id, updates) => {
        const updateRecursive = (currentBlocks) => {
            return currentBlocks.map(b => {
                if (b.id === id) return { ...b, ...updates };
                if (b.columns) {
                    return {
                        ...b,
                        columns: b.columns.map(col => updateRecursive(col))
                    };
                }
                return b;
            });
        };
        pushToHistory(updateRecursive(blocks));
    };

    const deleteBlock = (id) => {
        const deleteRecursive = (currentBlocks) => {
            return currentBlocks
                .filter(b => b.id !== id)
                .map(b => {
                    if (b.columns) {
                        return {
                            ...b,
                            columns: b.columns.map(col => deleteRecursive(col))
                        };
                    }
                    return b;
                });
        };
        pushToHistory(deleteRecursive(blocks));
        if (selectedBlockId === id) setSelectedBlockId(null);
    };

    const moveBlock = (id, direction) => {
        const moveRecursive = (currentBlocks) => {
            const index = currentBlocks.findIndex(b => b.id === id);

            // If found in this level
            if (index >= 0) {
                const newIndex = direction === 'up' ? index - 1 : index + 1;
                if (newIndex >= 0 && newIndex < currentBlocks.length) {
                    const newBlocks = [...currentBlocks];
                    const [moved] = newBlocks.splice(index, 1);
                    newBlocks.splice(newIndex, 0, moved);
                    return { handled: true, blocks: newBlocks };
                }
                return { handled: true, blocks: currentBlocks }; // Found but can't move
            }

            // Check nested columns
            let handled = false;
            const newBlocks = currentBlocks.map(b => {
                if (b.columns) {
                    let colChanged = false;
                    const newColumns = b.columns.map(col => {
                        const res = moveRecursive(col);
                        if (res.handled) {
                            handled = true;
                            colChanged = true;
                            return res.blocks;
                        }
                        return col;
                    });
                    if (colChanged) return { ...b, columns: newColumns };
                }
                return b;
            });
            return { handled, blocks: newBlocks };
        };

        const result = moveRecursive(blocks);
        if (result.handled) {
            pushToHistory(result.blocks);
        }
    };

    // --- TEMPLATE ACTIONS ---
    const saveTemplate = async () => {
        if (!templateName.trim()) return;
        try {
            await db.email_templates.add({
                name: templateName,
                blocks,
                globalStyles,
                created_at: new Date(),
                updated_at: new Date()
            });
            setTemplateName('');
            // alert('Template saved!'); // User doesn't like alerts usually, use UI feedback or silent success
        } catch (error) {
            console.error('Failed to save template:', error);
        }
    };

    const loadTemplate = (template) => {
        if (window.confirm('Load this template? Current changes will be replaced (you can Undo).')) {
            setBlocks(template.blocks);
            setGlobalStyles(template.globalStyles || DEFAULT_STYLES.container);
            pushToHistory(template.blocks);
        }
    };

    const deleteTemplate = async (id, e) => {
        e.stopPropagation();
        if (window.confirm('Delete this template?')) {
            await db.email_templates.delete(id);
        }
    };

    // --- DRAG AND DROP ---
    const onDragOver = (e) => {
        e.preventDefault();
    };

    const onDrop = (e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('toolType');
        if (type) {
            // In a real implementation we would calculate index based on Y position
            // For now, simple append
            addBlock(type);
        }
    };

    // --- RENDERERS ---

    const findBlock = (id) => {
        const findRecursive = (currentBlocks) => {
            for (const b of currentBlocks) {
                if (b.id === id) return b;
                if (b.columns) {
                    for (const col of b.columns) {
                        const found = findRecursive(col);
                        if (found) return found;
                    }
                }
            }
            return null;
        };
        return findRecursive(blocks);
    };

    const renderPropertiesPanel = () => {
        const block = findBlock(selectedBlockId);

        if (!block) {
            return (
                <div className="properties-content">
                    <p style={{ color: '#94a3b8', textAlign: 'center' }}>Select a block to edit its properties.</p>
                    <div className="prop-group" style={{ marginTop: '20px' }}>
                        <span className="prop-label">Global Settings</span>
                        <div className="prop-row">
                            <label style={{ fontSize: '0.8rem', color: '#fff' }}>Background</label>
                            <input
                                type="color"
                                value={globalStyles.backgroundColor}
                                onChange={e => setGlobalStyles({ ...globalStyles, backgroundColor: e.target.value })}
                                style={{ background: 'transparent', border: 'none', width: '30px', height: '30px' }}
                            />
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="properties-content">
                <div className="prop-group">
                    <span className="prop-label">Content</span>

                    {block.type === 'text' && (
                        <textarea
                            className="prop-textarea"
                            value={block.content.text || ''}
                            onChange={e => updateBlock(block.id, { content: { ...block.content, text: e.target.value } })}
                        />
                    )}

                    {block.type === 'button' && (
                        <>
                            <input
                                className="prop-input mb-2"
                                placeholder="Button Text"
                                value={block.content.text || ''}
                                onChange={e => updateBlock(block.id, { content: { ...block.content, text: e.target.value } })}
                            />
                            <input
                                className="prop-input"
                                placeholder="URL (https://...)"
                                value={block.content.link || ''}
                                onChange={e => updateBlock(block.id, { content: { ...block.content, link: e.target.value } })}
                            />
                        </>
                    )}

                    {block.type === 'image' && (
                        <>
                            <input
                                className="prop-input mb-2"
                                placeholder="Image URL"
                                value={block.content.url || ''}
                                onChange={e => updateBlock(block.id, { content: { ...block.content, url: e.target.value } })}
                            />
                            <input
                                className="prop-input"
                                placeholder="Alt Text"
                                value={block.content.alt || ''}
                                onChange={e => updateBlock(block.id, { content: { ...block.content, alt: e.target.value } })}
                            />
                        </>
                    )}

                    {block.type === 'footer' && (
                        <>
                            <input
                                className="prop-input mb-2"
                                placeholder="Company Name"
                                value={block.content.companyName || ''}
                                onChange={e => updateBlock(block.id, { content: { ...block.content, companyName: e.target.value } })}
                            />
                            <textarea
                                className="prop-textarea"
                                placeholder="Address"
                                value={block.content.address || ''}
                                onChange={e => updateBlock(block.id, { content: { ...block.content, address: e.target.value } })}
                            />
                        </>
                    )}

                    {block.type === 'social' && (
                        <>
                            <span className="prop-label" style={{ marginTop: '10px' }}>Social Links</span>
                            <input className="prop-input mb-2" placeholder="Facebook URL" value={block.content.facebook || ''} onChange={e => updateBlock(block.id, { content: { ...block.content, facebook: e.target.value } })} />
                            <input className="prop-input mb-2" placeholder="Twitter URL" value={block.content.twitter || ''} onChange={e => updateBlock(block.id, { content: { ...block.content, twitter: e.target.value } })} />
                            <input className="prop-input mb-2" placeholder="Instagram URL" value={block.content.instagram || ''} onChange={e => updateBlock(block.id, { content: { ...block.content, instagram: e.target.value } })} />
                        </>
                    )}

                    {block.type === 'html' && (
                        <>
                            <span className="prop-label">Custom HTML</span>
                            <textarea
                                className="prop-textarea"
                                style={{ fontFamily: 'monospace', minHeight: '150px' }}
                                value={block.content.html || ''}
                                onChange={e => updateBlock(block.id, { content: { ...block.content, html: e.target.value } })}
                            />
                        </>
                    )}

                    {block.type === 'product' && (
                        <>
                            <span className="prop-label">Select Product</span>
                            <div className="product-search-box" style={{ marginBottom: '15px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.1)', padding: '5px 10px', borderRadius: '4px', marginBottom: '5px' }}>
                                    <Search size={14} color="#94a3b8" />
                                    <input
                                        type="text"
                                        placeholder="Search products..."
                                        value={productSearch}
                                        onChange={e => setProductSearch(e.target.value)}
                                        style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '12px', marginLeft: '5px', width: '100%', outline: 'none' }}
                                    />
                                </div>
                                {productSearch && (
                                    <div className="product-results" style={{ maxHeight: '150px', overflowY: 'auto', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px' }}>
                                        {products
                                            .filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()))
                                            .slice(0, 5)
                                            .map(p => (
                                                <div
                                                    key={p.id}
                                                    style={{ padding: '8px', borderBottom: '1px solid #1e293b', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                                    className="product-result-item"
                                                    onClick={() => {
                                                        const img = p.images && p.images[0] ? p.images[0].src : '';
                                                        updateBlock(block.id, {
                                                            content: {
                                                                ...block.content,
                                                                name: p.name,
                                                                price: p.regular_price ? `$${p.regular_price}` : (p.price ? `$${p.price}` : ''),
                                                                imageUrl: img,
                                                                link: p.permalink || '#'
                                                            }
                                                        });
                                                        setProductSearch('');
                                                    }}
                                                >
                                                    {p.images && p.images[0] && <img src={p.images[0].src} style={{ width: '20px', height: '20px', borderRadius: '2px' }} alt="" />}
                                                    <span style={{ color: '#cbd5e1' }}>{p.name}</span>
                                                </div>
                                            ))
                                        }
                                    </div>
                                )}
                            </div>

                            <span className="prop-label">Product Details</span>
                            <input className="prop-input mb-2" placeholder="Product Name" value={block.content.name || ''} onChange={e => updateBlock(block.id, { content: { ...block.content, name: e.target.value } })} />
                            <input className="prop-input mb-2" placeholder="Price (e.g. $99)" value={block.content.price || ''} onChange={e => updateBlock(block.id, { content: { ...block.content, price: e.target.value } })} />
                            <input className="prop-input mb-2" placeholder="Image URL" value={block.content.imageUrl || ''} onChange={e => updateBlock(block.id, { content: { ...block.content, imageUrl: e.target.value } })} />
                            <input className="prop-input mb-2" placeholder="Product Link" value={block.content.link || ''} onChange={e => updateBlock(block.id, { content: { ...block.content, link: e.target.value } })} />
                        </>
                    )}

                    {block.type === 'order_summary' && (
                        <div style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', fontSize: '0.8rem', color: '#94a3b8' }}>
                            Order Summary is automatically populated with dynamic order data when sent.
                        </div>
                    )}
                </div>

                <div className="prop-group">
                    <span className="prop-label">Styles</span>

                    {/* Common Padding */}
                    <div className="prop-row mb-2">
                        <div style={{ flex: 1 }}>
                            <span className="prop-label" style={{ fontSize: '0.7rem' }}>Padding</span>
                            <input
                                className="prop-input"
                                value={block.styles.padding || ''}
                                onChange={e => updateBlock(block.id, { styles: { ...block.styles, padding: e.target.value } })}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <span className="prop-label" style={{ fontSize: '0.7rem' }}>Bg Color</span>
                            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '4px' }}>
                                <input
                                    type="color"
                                    value={block.styles.backgroundColor || '#ffffff'}
                                    onChange={e => updateBlock(block.id, { styles: { ...block.styles, backgroundColor: e.target.value } })}
                                    style={{ border: 'none', background: 'transparent', width: '100%', height: '24px' }}
                                />
                            </div>
                        </div>
                    </div>

                    {block.type === 'text' && (
                        <div className="prop-row">
                            <div style={{ flex: 1 }}>
                                <span className="prop-label" style={{ fontSize: '0.7rem' }}>Text Color</span>
                                <input
                                    type="color"
                                    value={block.styles.color || '#333333'}
                                    onChange={e => updateBlock(block.id, { styles: { ...block.styles, color: e.target.value } })}
                                    style={{ border: 'none', width: '100%', height: '30px' }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <span className="prop-label" style={{ fontSize: '0.7rem' }}>Align</span>
                                <select
                                    className="prop-select"
                                    value={block.styles.textAlign || 'left'}
                                    onChange={e => updateBlock(block.id, { styles: { ...block.styles, textAlign: e.target.value } })}
                                >
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {block.type === 'button' && (
                        <>
                            <div className="prop-row mb-2">
                                <div style={{ flex: 1 }}>
                                    <span className="prop-label" style={{ fontSize: '0.7rem' }}>Btn Color</span>
                                    <input
                                        type="color"
                                        value={block.styles.backgroundColor || '#3b82f6'}
                                        onChange={e => updateBlock(block.id, { styles: { ...block.styles, backgroundColor: e.target.value } })}
                                        style={{ border: 'none', width: '100%', height: '30px' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <span className="prop-label" style={{ fontSize: '0.7rem' }}>Text Color</span>
                                    <input
                                        type="color"
                                        value={block.styles.color || '#ffffff'}
                                        onChange={e => updateBlock(block.id, { styles: { ...block.styles, color: e.target.value } })}
                                        style={{ border: 'none', width: '100%', height: '30px' }}
                                    />
                                </div>
                            </div>
                            <div className="prop-row">
                                <div style={{ flex: 1 }}>
                                    <span className="prop-label" style={{ fontSize: '0.7rem' }}>Align</span>
                                    <select
                                        className="prop-select"
                                        value={block.styles.align || 'center'}
                                        onChange={e => updateBlock(block.id, { styles: { ...block.styles, align: e.target.value } })}
                                    >
                                        <option value="left">Left</option>
                                        <option value="center">Center</option>
                                        <option value="right">Right</option>
                                    </select>
                                </div>
                            </div>
                        </>
                    )}

                </div>
            </div>
        );
    };

    const renderCanvasBlock = (block) => {
        const isSelected = selectedBlockId === block.id;

        // This is a PREVIEW rendering, separate from the HTML generation
        // It mimics the styles but renders as React components for interactivity

        let content = null;
        if (block.type === 'text') {
            content = <div style={{ ...block.styles }}>{block.content.text}</div>;
        } else if (block.type === 'image') {
            content = (
                <div style={{ ...block.styles, padding: block.styles.padding }}>
                    {block.content.url ? (
                        <img src={block.content.url} alt={block.content.alt} style={{ maxWidth: '100%' }} />
                    ) : (
                        <div style={{ background: '#f1f5f9', padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                            <ImageIcon size={32} />
                            <p>No Image Selected</p>
                        </div>
                    )}
                </div>
            );
        } else if (block.type === 'button') {
            content = (
                <div style={{ textAlign: block.styles.align || 'center', padding: block.styles.padding, background: block.styles.padding ? 'transparent' : 'white' }}>
                    <span style={{
                        backgroundColor: block.styles.backgroundColor,
                        color: block.styles.color,
                        padding: '12px 24px',
                        borderRadius: block.styles.borderRadius || '4px',
                        display: 'inline-block',
                        fontWeight: 'bold',
                        textDecoration: 'none'
                    }}>
                        {block.content.text}
                    </span>
                </div>
            );
        } else if (block.type === 'spacer') {
            content = <div style={{ height: block.styles.height || '20px' }}></div>;
        } else if (block.type === 'divider') {
            content = <div style={{ padding: block.styles.padding }}><hr style={{ borderColor: block.styles.color }} /></div>;
        } else if (block.type === 'footer') {
            content = (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '12px' }}>
                    <p>{block.content.companyName}</p>
                    <p>{block.content.address}</p>
                    <p>Unsubscribe Link (Preview)</p>
                </div>
            );
        } else if (block.type === 'social') {
            content = (
                <div style={{ textAlign: 'center', padding: '10px', display: 'flex', gap: '10px', justifyContent: 'center', color: block.styles.color }}>
                    {block.content.facebook && <span>Facebook</span>}
                    {block.content.twitter && <span>Twitter</span>}
                    {block.content.instagram && <span>Instagram</span>}
                    {!block.content.facebook && !block.content.twitter && !block.content.instagram && <span style={{ opacity: 0.5 }}>Configure social links...</span>}
                </div>
            );
        } else if (block.type === 'html') {
            content = (
                <div style={{ padding: '10px', background: '#f0f0f0', border: '1px dashed #ccc', fontFamily: 'monospace', fontSize: '12px', color: '#333' }}>
                    <strong>HTML Block:</strong>
                    <div style={{ marginTop: '5px', overflow: 'hidden', maxHeight: '100px', whiteSpace: 'pre-wrap', textOverflow: 'ellipsis' }}>{block.content.html}</div>
                </div>
            );
        } else if (block.type === 'product') {
            content = (
                <div style={{ border: '1px solid #eee', padding: '10px', borderRadius: '4px', textAlign: 'center', background: 'white', color: '#333' }}>
                    {block.content.imageUrl ?
                        <img src={block.content.imageUrl} style={{ height: '80px', width: '80px', objectFit: 'cover', margin: '0 auto 10px', borderRadius: '4px' }} alt="Product" referrerPolicy="no-referrer" /> :
                        <div style={{ height: '80px', width: '80px', background: '#e2e8f0', margin: '0 auto 10px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}><ShoppingBag size={24} /></div>
                    }
                    <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{block.content.name || 'Product Name'}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{block.content.price || '$99.00'}</div>
                    <div style={{ marginTop: '5px', padding: '6px 12px', background: '#1e293b', color: 'white', display: 'inline-block', borderRadius: '4px', fontSize: '12px' }}>Buy Now</div>
                </div>
            );
        } else if (block.type === 'section') {
            content = (
                <div style={{ display: 'flex', gap: '10px', padding: block.styles.padding || '10px' }}>
                    {block.columns.map((colBlocks, colIndex) => (
                        <div
                            key={colIndex}
                            className="column-drop-zone"
                            style={{
                                flex: block.layout === '1-2-col' ? (colIndex === 0 ? 1 : 2) :
                                    block.layout === '2-1-col' ? (colIndex === 0 ? 2 : 1) : 1
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation(); // Stop from dropping on parent canvas
                                const toolType = e.dataTransfer.getData('toolType');
                                if (toolType && !STRUCTURE_TOOLS.find(t => t.type === toolType)) {
                                    // Only allow content blocks, not nested sections (simple for now)
                                    addBlockToColumn(block.id, colIndex, toolType);
                                }
                            }}
                        >
                            {colBlocks.length === 0 && <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center', padding: '10px' }}>Drop Here</div>}
                            {colBlocks.map(subBlock => renderCanvasBlock(subBlock))}
                        </div>
                    ))}
                </div>
            );
        }

        return (
            <div
                key={block.id}
                className={`canvas-block ${isSelected ? 'selected' : ''}`}
                onClick={(e) => { e.stopPropagation(); setSelectedBlockId(block.id); }}
            >
                {/* Actions */}
                <div className="block-actions">
                    {/* Only Show Grip for Sort if Sortable implemented */}
                    <button className="block-action-btn" onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 'up'); }} title="Move Up"><ArrowUp size={14} /></button>
                    <button className="block-action-btn" onClick={(e) => { e.stopPropagation(); moveBlock(block.id, 'down'); }} title="Move Down"><ArrowDown size={14} /></button>
                    <button className="block-action-btn" onClick={(e) => { e.stopPropagation(); deleteBlock(block.id); }} title="Delete"><Trash2 size={14} /></button>
                </div>

                {/* Content */}
                {content}
            </div>
        );
    };

    return createPortal(
        <div className="email-designer-modal">
            {/* Header */}
            <div className="designer-header">
                <div className="designer-title">
                    <Layout size={20} color="#60a5fa" />
                    <span>Email Designer</span>
                </div>

                <div className="mode-toggle">
                    <button className={`mode-btn ${mode === 'visual' ? 'active' : ''}`} onClick={() => setMode('visual')}><Eye size={14} /> Visual</button>
                    <button className={`mode-btn ${mode === 'code' ? 'active' : ''}`} onClick={() => setMode('code')}><Code size={14} /> Code</button>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ marginRight: '10px', display: 'flex', gap: '5px' }}>
                        <button className="btn" onClick={undo} disabled={historyIndex <= 0} style={{ padding: '8px', opacity: historyIndex <= 0 ? 0.5 : 1 }}>
                            <ArrowLeft size={16} /> {/* Need to import ArrowLeft or similar, using RotateCcw for now if available, or just Text */}
                            <span style={{ marginLeft: '5px' }}>Undo</span>
                        </button>
                        <button className="btn" onClick={redo} disabled={historyIndex >= history.length - 1} style={{ padding: '8px', opacity: historyIndex >= history.length - 1 ? 0.5 : 1 }}>
                            <span style={{ marginRight: '5px' }}>Redo</span>
                            {/* Icon here */}
                        </button>
                    </div>

                    <button className="btn" onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)' }}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => onSave({ html: htmlCode, design: { blocks, globalStyles }, type: mode })}>
                        <Save size={16} /> Save Email
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="designer-body">
                {/* Visual Editor Layout */}
                {mode === 'visual' ? (
                    <>
                        {/* Sidebar */}
                        <div className="designer-sidebar">
                            <div className="sidebar-tabs">
                                <button className={`sidebar-tab ${activeTab === 'structure' ? 'active' : ''}`} onClick={() => setActiveTab('structure')}>Structure</button>
                                <button className={`sidebar-tab ${activeTab === 'blocks' ? 'active' : ''}`} onClick={() => setActiveTab('blocks')}>Blocks</button>
                                <button className={`sidebar-tab ${activeTab === 'layouts' ? 'active' : ''}`} onClick={() => setActiveTab('layouts')}>Layouts</button>
                                <button className={`sidebar-tab ${activeTab === 'check' ? 'active' : ''}`} onClick={() => setActiveTab('check')} title="Audit / Check">
                                    <CheckCircle size={16} />
                                </button>
                            </div>

                            <div className="sidebar-content">
                                {activeTab === 'blocks' && (
                                    <>
                                        <div className="tools-category-title">General</div>
                                        <div className="tools-grid">
                                            {GENERAL_TOOLS.map((tool) => (
                                                <div
                                                    key={tool.type}
                                                    className="tool-item"
                                                    draggable
                                                    onDragStart={(e) => e.dataTransfer.setData('toolType', tool.type)}
                                                    onClick={() => addBlock(tool.type)}
                                                >
                                                    <tool.icon size={24} strokeWidth={1.5} color="#94a3b8" />
                                                    <span>{tool.label}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="tools-category-title">WooCommerce</div>
                                        <div className="tools-grid">
                                            {WOO_TOOLS.map((tool) => (
                                                <div
                                                    key={tool.type}
                                                    className="tool-item"
                                                    draggable
                                                    onDragStart={(e) => e.dataTransfer.setData('toolType', tool.type)}
                                                    onClick={() => addBlock(tool.type)}
                                                >
                                                    <tool.icon size={24} strokeWidth={1.5} color="#94a3b8" />
                                                    <span>{tool.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {activeTab === 'structure' && (
                                    <>
                                        <div className="tools-category-title">Sections</div>
                                        <div className="tools-grid">
                                            {STRUCTURE_TOOLS.map((tool) => (
                                                <div
                                                    key={tool.type}
                                                    className="tool-item"
                                                    draggable
                                                    onDragStart={(e) => e.dataTransfer.setData('toolType', tool.type)}
                                                    onClick={() => addBlock(tool.type)}
                                                >
                                                    <tool.icon size={24} strokeWidth={1.5} color="#94a3b8" />
                                                    <span>{tool.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {activeTab === 'layouts' && (
                                    <div style={{ padding: '20px' }}>
                                        <div style={{ marginBottom: '25px', padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Save Current Layout</div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <input
                                                    type="text"
                                                    placeholder="Template Name..."
                                                    value={templateName}
                                                    onChange={e => setTemplateName(e.target.value)}
                                                    className="prop-input"
                                                    style={{ flex: 1 }}
                                                />
                                                <button
                                                    onClick={saveTemplate}
                                                    disabled={!templateName.trim()}
                                                    className="btn btn-primary"
                                                    style={{ padding: '8px 12px', opacity: templateName.trim() ? 1 : 0.5 }}
                                                >
                                                    <Save size={16} />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="tools-category-title">My Templates</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {templates.length === 0 && <div style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.9rem', textAlign: 'center', padding: '30px' }}>No saved templates yet.</div>}
                                            {templates.map(t => (
                                                <div
                                                    key={t.id}
                                                    className="template-item"
                                                    onClick={() => loadTemplate(t)}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '6px', borderRadius: '6px' }}>
                                                            <Layout size={16} color="#60a5fa" />
                                                        </div>
                                                        <span style={{ fontSize: '0.9rem', color: '#f1f5f9' }}>{t.name}</span>
                                                    </div>
                                                    <button
                                                        onClick={(e) => deleteTemplate(t.id, e)}
                                                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.7, padding: '4px' }}
                                                        title="Delete Template"
                                                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                                                        onMouseLeave={e => e.currentTarget.style.opacity = 0.7}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'check' && (
                                    (() => {
                                        const validationIssues = validateEmail(blocks, globalStyles || { container: { contentWidth: 600 } });
                                        return (
                                            <div style={{ padding: '15px' }}>
                                                <div style={{ marginBottom: '20px', padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <div style={{ fontSize: '2.5rem', fontWeight: 800, color: validationIssues.length === 0 ? '#4ade80' : validationIssues.some(i => i.severity === 'error') ? '#ef4444' : '#facc15', lineHeight: 1 }}>
                                                        {validationIssues.length}
                                                    </div>
                                                    <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '5px', fontWeight: 600 }}>Issues Found</div>
                                                </div>

                                                {validationIssues.length === 0 && (
                                                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
                                                        <CheckCircle size={48} color="#4ade80" style={{ marginBottom: '15px', opacity: 0.8 }} />
                                                        <div style={{ fontWeight: 600, color: '#f1f5f9' }}>Great job!</div>
                                                        <div style={{ fontSize: '0.9rem' }}>No obvious compatibility issues found.</div>
                                                    </div>
                                                )}

                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                    {validationIssues.map((issue, idx) => (
                                                        <div
                                                            key={idx}
                                                            style={{
                                                                background: 'rgba(255,255,255,0.03)',
                                                                borderLeft: `4px solid ${issue.severity === 'error' ? '#ef4444' : issue.severity === 'warning' ? '#facc15' : '#3b82f6'}`,
                                                                borderRadius: '0 8px 8px 0',
                                                                padding: '15px',
                                                                cursor: issue.blockId ? 'pointer' : 'default',
                                                                transition: 'background 0.2s'
                                                            }}
                                                            className="audit-item"
                                                            onClick={() => issue.blockId && setSelectedBlockId(issue.blockId)}
                                                            onMouseEnter={(e) => issue.blockId && (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                                                            onMouseLeave={(e) => issue.blockId && (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                                                        >
                                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                                                {issue.severity === 'error' && <AlertTriangle size={18} color="#ef4444" style={{ marginTop: '2px', flexShrink: 0 }} />}
                                                                {issue.severity === 'warning' && <AlertTriangle size={18} color="#facc15" style={{ marginTop: '2px', flexShrink: 0 }} />}
                                                                {issue.severity === 'info' && <Info size={18} color="#3b82f6" style={{ marginTop: '2px', flexShrink: 0 }} />}
                                                                <div>
                                                                    <div style={{ fontSize: '0.85rem', color: issue.severity === 'error' ? '#fca5a5' : issue.severity === 'warning' ? '#fde047' : '#93c5fd', marginBottom: '4px', fontWeight: 700 }}>
                                                                        {issue.severity === 'error' ? 'Critical Issue' : issue.severity === 'warning' ? 'Recommendation' : 'Optimization Tip'}
                                                                    </div>
                                                                    <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.5' }}>{issue.message}</div>
                                                                    {issue.blockId && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px', fontStyle: 'italic' }}>Click to select block</div>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()
                                )}
                            </div>

                            <div className="sidebar-bottom-bar">
                                <div className="bottom-bar-item" onClick={() => setSelectedBlockId(null)}><Settings size={16} /> Layout Settings</div>
                                <div className="bottom-bar-item" onClick={() => setSelectedBlockId(null)}><Globe size={16} /> Global Settings</div>
                            </div>
                        </div>

                        {/* Canvas */}
                        <div className="designer-canvas-area" onClick={() => setSelectedBlockId(null)} onDragOver={onDragOver} onDrop={onDrop}>
                            <div className="email-canvas" style={{ backgroundColor: globalStyles.backgroundColor }}>
                                {blocks.length === 0 ? (
                                    <div className="empty-canvas-placeholder">
                                        <MousePointer2 size={48} color="#cbd5e1" style={{ marginBottom: '20px', opacity: 0.2 }} />
                                        <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '8px', fontSize: '1.2rem' }}>Start Designing</div>
                                        <div style={{ fontSize: '0.95rem', maxWidth: '300px', margin: '0 auto', lineHeight: '1.5' }}>
                                            Drag tools from the sidebar or click them to add blocks to your email.
                                        </div>
                                    </div>
                                ) : (
                                    blocks.map(renderCanvasBlock)
                                )}
                            </div>
                        </div>

                        {/* Properties */}
                        <div className="designer-properties">
                            <div className="properties-header">
                                {selectedBlockId ? 'Edit Block' : 'Global Settings'}
                            </div>
                            {renderPropertiesPanel()}
                        </div>
                    </>
                ) : (
                    /* Code Editor Layout */
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px' }}>
                        <div style={{ color: '#94a3b8', marginBottom: '10px', fontSize: '0.9rem' }}>
                            Edit the generating HTML directly.
                            <span style={{ color: '#ef4444', marginLeft: '10px' }}>Warning: Switching back to Visual mode may overwrite custom code additions if they don't match the block structure.</span>
                        </div>
                        <textarea
                            className="form-input"
                            style={{ flex: 1, fontFamily: 'monospace', fontSize: '14px', lineHeight: '1.5' }}
                            value={htmlCode}
                            onChange={(e) => setHtmlCode(e.target.value)}
                        />
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
