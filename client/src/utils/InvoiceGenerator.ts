
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

    const pageWidth = doc.internal.pageSize.getWidth(); // 210

    // Grid System: 12 Cols
    const colWidth = pageWidth / 12;
    // Row Height is virtual in RGL (e.g. 30px), we need to map y-coord to mm.
    // Assuming 30px ~ 8mm roughly? or just relative.
    // Let's approximate: RGL rowHeight=30. In 96dpi, 30px = 7.9mm.
    const rowHeightMM = 8;

    // Helper to get coordinates
    const getRect = (item: InvoiceLayoutItem) => {
        return {
            x: item.x * colWidth, // 0-12
            y: item.y * rowHeightMM + 10, // Margin top 10mm
            w: item.w * colWidth,
            h: item.h * rowHeightMM
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

        if (type === 'header') {
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

            // Render business details (right side)
            if (itemConfig.businessDetails) {
                const textX = x + (w * 0.35); // Start after logo area
                const textWidth = w * 0.65;
                doc.setFontSize(10);
                doc.setFont("helvetica", "normal");
                const lines = itemConfig.businessDetails.split('\n');
                let currentY = y + 5;
                lines.forEach((line: string) => {
                    doc.text(line, textX, currentY, { maxWidth: textWidth });
                    currentY += 4;
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
            // Use AutoTable
            const tableData = order.line_items.map(p => [
                p.name,
                p.quantity,
                formatPrice(p.price, order.currency),
                formatPrice(p.total, order.currency)
            ]);

            autoTable(doc, {
                startY: y,
                margin: { left: x },
                tableWidth: w,
                head: [['Item', 'Qty', 'Price', 'Total']],
                body: tableData,
                theme: 'grid',
                styles: { fontSize: 9 },
                headStyles: { fillColor: [66, 66, 66] }
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

    // Render Footer on Last Page
    if (footerItems.length > 0) {
        const pageCount = (doc.internal as any).getNumberOfPages();
        doc.setPage(pageCount);

        footerItems.forEach(({ layoutItem, itemConfig }) => {
            const { x, y, w } = getRect(layoutItem);
            const content = itemConfig.content || '';

            doc.setFontSize(8);
            doc.setTextColor(100);
            doc.text(content, x + (w / 2), y + 5, { align: 'center', maxWidth: w });
            doc.setTextColor(0);
        });
    }

    // Save
    doc.save(`Invoice_${order.number}.pdf`);
};

function formatPrice(amount: string | number, currency: string) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(amount));
}
