
import jsPDF from 'jspdf';
import { Logger } from './logger';
import autoTable from 'jspdf-autotable';

interface InvoiceLayoutItem {
    id: string;
    type: string;
    content?: string;
    // RGL properties
    x: number;
    y: number;
    w: number;
    h: number;
}

interface OrderData {
    number: string;
    date_created: string;
    line_items: any[];
    total: string;
    total_tax: string;
    currency: string;
    billing?: any;
    shipping?: any;
    [key: string]: any;
}

const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = url;
        img.onload = () => resolve(img);
        img.onerror = reject;
    });
};

/**
 * Safely converts any value to a displayable string
 * Handles nested objects, arrays, and primitive types
 */
const safeStringify = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(v => safeStringify(v)).join(', ');
    if (typeof val === 'object') {
        const entries = Object.entries(val);
        if (entries.length === 0) return '';
        return entries.map(([_k, v]) => safeStringify(v)).filter(Boolean).join(', ');
    }
    return String(val);
};

/**
 * Extracts user-facing metadata from an order line item
 * Filters out internal plugin/system keys and returns label/value pairs
 * Prevents duplicate entries by tracking seen labels
 */
const getItemMeta = (item: any): { label: string; value: string }[] => {
    const meta: { label: string; value: string }[] = [];
    const seenLabels = new Set<string>(); // Track labels to prevent duplicates

    // Helper to add meta entry only if not already seen
    const addMeta = (label: string, value: string) => {
        const normalizedLabel = label.toLowerCase().trim();
        if (!seenLabels.has(normalizedLabel) && value.length > 0 && value.length < 200) {
            seenLabels.add(normalizedLabel);
            meta.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value });
        }
    };

    // Keys to always exclude (internal plugin/system keys)
    const excludedKeyPatterns = [
        /^_/,                    // Internal underscore-prefixed keys
        /^pa_/,                  // Already handled separately for variations
        /wcpa/i,                 // WCPA plugin internal data
        /meta_data/i,            // Nested meta references
        /^reduced_stock/i,       // Stock management internal
        /label_map/i,            // Internal mappings
        /droppable/i,            // UI state fields
        /^id$/i,                 // Internal IDs
        /^key$/i,                // Internal keys
    ];

    const isExcludedKey = (key: string) =>
        excludedKeyPatterns.some(pattern => pattern.test(key));

    // Standard fields
    if (item.sku) addMeta('SKU', item.sku);

    // Variation attributes only (pa_ prefixed keys)
    if (item.variation_id && item.variation_id > 0) {
        const attrs = item.meta_data?.filter((m: any) =>
            m.key?.startsWith('pa_')
        ) || [];
        attrs.forEach((attr: any) => {
            const label = attr.display_key || attr.key.replace('pa_', '').replace(/_/g, ' ');
            const rawValue = attr.display_value || attr.value;
            const strValue = safeStringify(rawValue);
            addMeta(label, strValue);
        });
    }

    // Custom meta fields - strict filtering (non pa_ keys with display values)
    const customMeta = item.meta_data?.filter((m: any) => {
        const key = m.key || '';
        if (isExcludedKey(key)) return false;
        if (key.startsWith('pa_')) return false; // Already handled above
        if (!m.display_key && !m.display_value) return false;
        return true;
    }) || [];

    customMeta.forEach((m: any) => {
        const rawValue = m.display_value || m.value;
        const strValue = safeStringify(rawValue);
        if (strValue.length > 0) {
            const label = m.display_key || m.key.replace(/_/g, ' ');
            addMeta(label, strValue);
        }
    });

    return meta;
};


/**
 * Generates specific invoice PDF based on layout and order data
 */
export const generateInvoicePDF = async (order: OrderData, grid: any[], items: any[], _templateName: string = 'Invoice') => {
    // 1. Initialize PDF
    // A4 size: 210mm x 297mm
    const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth(); // 210mm

    // Page margins
    const pageMarginLeft = 10;
    const pageMarginRight = 10;
    const pageMarginTop = 10;
    const usableWidth = pageWidth - pageMarginLeft - pageMarginRight; // 190mm

    // Grid System: 12 Cols within usable width
    const colWidth = usableWidth / 12;

    // Row Height: RGL uses 30px rowHeight. Scale to mm.
    // Preview is 794px wide for ~210mm → scale factor ~0.264
    // 30px * 0.264 ≈ 8mm
    const rowHeightMM = 8;

    // Page dimensions for page break handling
    const pageHeight = doc.internal.pageSize.getHeight(); // 297mm for A4

    // Reserved zones to prevent content overlap
    const headerReservedHeight = 35; // Space reserved for header on page 1 (logo + business details)
    const footerReservedHeight = 25; // Space reserved for footer at bottom

    // Calculate content safe zone
    const contentTopPage1 = pageMarginTop + headerReservedHeight; // ~45mm on page 1
    const contentTopOther = pageMarginTop; // 10mm on subsequent pages
    const contentBottom = pageHeight - footerReservedHeight; // ~272mm from top

    // Track current Y offset for page breaks
    let yOffset = 0;
    let currentPage = 1;

    // Helper to check if we need a page break before rendering an element
    const checkPageBreak = (elementY: number, elementH: number): number => {
        const adjustedY = elementY + yOffset;

        // If element would exceed content safe zone, add new page
        if (adjustedY + elementH > contentBottom) {
            doc.addPage();
            currentPage++;
            // On new pages, content starts at top margin (no header reserved space)
            yOffset = -elementY + contentTopOther;
            return contentTopOther;
        }

        return adjustedY;
    };

    // Helper to get coordinates with page break awareness
    const getRect = (item: InvoiceLayoutItem) => {
        const baseY = pageMarginTop + (item.y * rowHeightMM);
        const h = item.h * rowHeightMM;
        const adjustedY = checkPageBreak(baseY, h);

        return {
            x: pageMarginLeft + (item.x * colWidth),
            y: adjustedY,
            w: item.w * colWidth,
            h: h
        };
    };

    // Sort items by Y to render top-down
    const sortedGrid = [...grid].sort((a, b) => a.y - b.y);

    const footerItems: any[] = [];

    for (const layoutItem of sortedGrid) {
        const itemConfig = items.find(i => i.id === layoutItem.i);
        if (!itemConfig) continue;

        const { x, y, w, h } = getRect(layoutItem);
        const type = itemConfig.type;
        const content = itemConfig.content;
        const style = itemConfig.style || {};

        if (type === 'footer') {
            footerItems.push({ layoutItem, itemConfig });
            continue;
        }

        // Header only renders on page 1
        if (type === 'header') {
            if (currentPage !== 1) continue; // Skip header on subsequent pages

            // Render logo if available (left side)
            if (itemConfig.logo) {
                try {
                    const img = await loadImage(itemConfig.logo);
                    const logoWidth = w * 0.3; // 30% of header width for logo
                    const logoHeight = h;
                    doc.addImage(img, 'PNG', x, y, logoWidth, logoHeight, undefined, 'FAST');
                } catch (e) {
                    Logger.error('Failed to load logo image', { error: e });
                }
            }

            // Render business details (right-aligned within header bounds)
            if (itemConfig.businessDetails) {
                // Right-align business details to header element's right edge
                // This respects the element bounds set in the designer
                const textX = x + w; // Right edge of the header element

                // Dynamic font sizing based on header height
                // Calculate based on number of lines and available height
                const lines = itemConfig.businessDetails.split('\n');
                const lineCount = lines.length || 1;

                // Calculate optimal font size to fit content in available height
                // Each line needs ~1.2x font size in mm for proper spacing
                // h is in mm, we need pt (1mm ≈ 2.83pt)
                const availableHeightMM = h - 4; // Leave 4mm padding (2mm top + 2mm bottom)
                const lineHeightMM = availableHeightMM / lineCount;

                // Convert to points and clamp between readable bounds
                // lineHeightMM * 2.83 gives pt, divide by ~1.3 for actual font size
                const calculatedFontSize = (lineHeightMM * 2.83) / 1.3;
                const fontSize = Math.max(7, Math.min(12, calculatedFontSize));

                // Line spacing in mm (font size in pt / 2.83 * 1.2 for spacing)
                const lineSpacing = (fontSize / 2.83) * 1.2;

                doc.setFontSize(fontSize);
                doc.setFont("helvetica", "normal");

                // Start text from top of element with small padding
                let currentY = y + 2 + (fontSize / 2.83); // Account for baseline
                lines.forEach((line: string) => {
                    doc.text(line, textX, currentY, { align: 'right' });
                    currentY += lineSpacing;
                });
            }
        }
        else if (type === 'text') {
            let text = content || '';
            // Handlebars replacement
            text = text.replace(/{{(.*?)}}/g, (_: any, key: string) => {
                const k = key.trim();
                // Deep access could be handled here if needed
                return order[k] || `{{${k}}}`;
            });

            // Apply Styles
            const fontSize = parseInt(style.fontSize || '14px');
            // Convert px to pt roughly (1px = 0.75pt)
            doc.setFontSize(fontSize * 0.75);

            const fontWeight = style.fontWeight === 'bold' ? 'bold' : 'normal';
            const fontStyle = style.fontStyle === 'italic' ? 'italic' : 'normal';

            if (fontWeight === 'bold' && fontStyle === 'italic') {
                doc.setFont("helvetica", "bolditalic");
            } else if (fontWeight === 'bold') {
                doc.setFont("helvetica", "bold");
            } else if (fontStyle === 'italic') {
                doc.setFont("helvetica", "italic");
            } else {
                doc.setFont("helvetica", "normal");
            }

            const align = style.textAlign || 'left';

            // Calculate X based on alignment
            let textX = x + 2;
            if (align === 'center') textX = x + (w / 2);
            if (align === 'right') textX = x + w - 2;

            doc.text(text, textX, y + 5, { align: align as any, maxWidth: w });
        }
        else if (type === 'image') {
            if (content) {
                try {
                    const img = await loadImage(content);
                    doc.addImage(img, 'PNG', x, y, w, h, undefined, 'FAST');
                } catch (e) {
                    Logger.error('Failed to load image', { error: e });
                    // Fallback
                    doc.setFillColor(240, 240, 240);
                    doc.rect(x, y, w, h, 'F');
                    doc.setFontSize(8);
                    doc.setTextColor(150);
                    doc.text('Image Error', x + w / 2, y + h / 2, { align: 'center' });
                    doc.setTextColor(0);
                }
            } else {
                // Placeholder
                doc.setFillColor(240, 240, 240);
                doc.rect(x, y, w, h, 'F');
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text('Image', x + w / 2, y + h / 2, { align: 'center' });
                doc.setTextColor(0);
            }
        }
        else if (type === 'order_details') {
            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");

            const orderNumber = order.number || order.order_number || 'N/A';
            const orderDate = order.date_created
                ? new Date(order.date_created).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : 'N/A';
            const paymentMethod = order.payment_method_title || order.payment_method || 'N/A';
            const shippingMethod = order.shipping_lines?.[0]?.method_title || order.shipping_method || 'N/A';

            let currentY = y + 5;

            doc.setTextColor(100);
            doc.text("Order Number:", x + 2, currentY);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");
            doc.text(String(orderNumber), x + 40, currentY);

            currentY += 5;
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100);
            doc.text("Order Date:", x + 2, currentY);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");
            doc.text(orderDate, x + 40, currentY);

            currentY += 5;
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100);
            doc.text("Payment Method:", x + 2, currentY);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");
            doc.text(paymentMethod, x + 40, currentY);

            currentY += 5;
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100);
            doc.text("Shipping Method:", x + 2, currentY);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");
            doc.text(shippingMethod, x + 40, currentY);

            doc.setFont("helvetica", "normal");
        }
        else if (type === 'customer_details') {
            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.text("Bill To:", x + 2, y + 5);
            doc.setFont("helvetica", "normal");

            let currentY = y + 10;
            const billing = order.billing || {};

            const lines = [
                `${billing.first_name || ''} ${billing.last_name || ''}`,
                billing.company,
                billing.address_1,
                billing.address_2,
                `${billing.city || ''}, ${billing.state || ''} ${billing.postcode || ''}`,
                billing.email,
                billing.phone
            ].filter(Boolean);

            lines.forEach(line => {
                doc.text(line, x + 2, currentY);
                currentY += 5;
            });
        }
        else if (type === 'order_table') {
            // Helper to truncate long text values for PDF display
            const truncateText = (text: string, maxLength: number = 80): string => {
                if (text.length <= maxLength) return text;
                return text.substring(0, maxLength - 3) + '...';
            };

            // Build table data with item metadata (SKU, variations, custom fields)
            const tableData = order.line_items.map(p => {
                const itemMeta = getItemMeta(p);

                // Build description with product name and metadata
                // Limit metadata to avoid excessive table row heights
                let description = p.name;
                if (itemMeta.length > 0) {
                    // Truncate long values and limit to max 6 metadata entries
                    const limitedMeta = itemMeta.slice(0, 6).map(m => {
                        const truncatedValue = truncateText(m.value, 60);
                        return `${m.label}: ${truncatedValue}`;
                    });
                    if (itemMeta.length > 6) {
                        limitedMeta.push(`... and ${itemMeta.length - 6} more`);
                    }
                    const metaStr = limitedMeta.join('\n');
                    description = `${p.name}\n${metaStr}`;
                }

                const unitPrice = p.quantity > 0
                    ? (parseFloat(p.total || 0) / p.quantity)
                    : parseFloat(p.price || 0);

                return [
                    description,
                    p.quantity,
                    formatPrice(unitPrice, order.currency),
                    formatPrice(p.total, order.currency)
                ];
            });

            // Calculate totals
            const subtotal = Number(order.total) - Number(order.total_tax || 0) - Number(order.shipping_total || 0);
            const shippingTotal = Number(order.shipping_total || 0);
            const tax = Number(order.total_tax || 0);
            const total = Number(order.total);

            // Build footer rows for totals
            const footerRows: any[][] = [
                ['', '', 'Subtotal', formatPrice(subtotal, order.currency)]
            ];
            if (shippingTotal > 0) {
                footerRows.push(['', '', 'Shipping', formatPrice(shippingTotal, order.currency)]);
            }
            footerRows.push(['', '', 'Tax', formatPrice(tax, order.currency)]);
            footerRows.push(['', '', { content: 'Total', styles: { fontStyle: 'bold', fontSize: 11 } }, { content: formatPrice(total, order.currency), styles: { fontStyle: 'bold', fontSize: 11 } }]);

            // Calculate column widths proportionally based on table width
            // Description should get ~66% of width, other columns share the rest
            const qtyWidth = Math.min(12, w * 0.08);
            const priceWidth = Math.min(22, w * 0.13);
            const totalWidth = Math.min(22, w * 0.13);
            // Description gets remaining space (at least 66% of table width)
            const descWidth = w - qtyWidth - priceWidth - totalWidth;

            autoTable(doc, {
                startY: y,
                margin: { left: x, right: pageWidth - x - w },
                tableWidth: w,
                head: [['Description', 'Qty', 'Unit Price', 'Total']],
                body: tableData,
                foot: footerRows,
                theme: 'grid',
                styles: {
                    fontSize: 9,
                    cellPadding: 3,
                    overflow: 'linebreak',
                    cellWidth: 'wrap'
                },
                headStyles: { fillColor: [66, 66, 66] },
                footStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0] },
                columnStyles: {
                    0: { cellWidth: descWidth },  // Description column - proportional width
                    1: { cellWidth: qtyWidth, halign: 'center' },  // Qty
                    2: { cellWidth: priceWidth, halign: 'right' },   // Unit Price
                    3: { cellWidth: totalWidth, halign: 'right' },   // Total
                },
                // Keep line items together - avoid page breaks within rows
                rowPageBreak: 'avoid'
            });
        }
        else if (type === 'totals') {
            // Render Totals
            let currentY = y + 5;

            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");

            doc.text(`Subtotal: ${formatPrice(Number(order.total) - Number(order.total_tax), order.currency)}`, x + w - 5, currentY, { align: 'right' });
            currentY += 5;
            doc.text(`Tax: ${formatPrice(order.total_tax, order.currency)}`, x + w - 5, currentY, { align: 'right' });
            currentY += 6;
            doc.setFont("helvetica", "bold");
            doc.text(`Total: ${formatPrice(order.total, order.currency)}`, x + w - 5, currentY, { align: 'right' });
            doc.setFont("helvetica", "normal");
        }
    }

    // Render Footer on Last Page (at bottom)
    if (footerItems.length > 0) {
        const pageCount = (doc.internal as any).getNumberOfPages();
        doc.setPage(pageCount);

        // Position footer near bottom of page
        const footerY = pageHeight - 20; // 20mm from bottom

        footerItems.forEach(({ layoutItem, itemConfig }) => {
            const content = itemConfig.content || '';
            const footerX = pageMarginLeft + (layoutItem.x * colWidth);
            const footerW = layoutItem.w * colWidth;

            doc.setFontSize(8);
            doc.setTextColor(100);
            doc.text(content, footerX + (footerW / 2), footerY, { align: 'center', maxWidth: footerW });
            doc.setTextColor(0);
        });
    }

    // Save
    doc.save(`Invoice_${order.number}.pdf`);
};

function formatPrice(amount: string | number, currency: string) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(amount));
}
