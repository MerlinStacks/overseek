import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    formatInvoiceCurrency,
    mergeInvoiceSettings,
    resolveInvoiceTemplateString,
} from '../../../packages/overseek-core/src/invoiceRenderModel';
import { getInvoiceItemMeta, getOrderGiftWrappingMeta } from '../../../packages/overseek-core/src/invoiceItemUtils';

/**
 * Legacy fallback invoice renderer.
 *
 * Canonical path is designer-capture in InvoiceGenerator.ts.
 * Keep this file for emergency fallback only.
 */

interface BillingData {
    first_name?: string;
    last_name?: string;
    email?: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    phone?: string;
}

interface ShippingLineData {
    method_title?: string;
}

interface LineItemData {
    name?: string;
    quantity?: number;
    total?: string | number;
    [key: string]: unknown;
}

interface InvoiceOrderData {
    id?: string | number;
    number?: string | number;
    order_number?: string | number;
    date_created?: string;
    payment_method_title?: string;
    payment_method?: string;
    shipping_lines?: ShippingLineData[];
    shipping_method?: string;
    billing?: BillingData;
    line_items?: LineItemData[];
    total?: string | number;
    total_tax?: string | number;
    shipping_total?: string | number;
    discount_total?: string | number;
    currency?: string;
}

interface InvoiceItemStyle {
    fontSize?: string;
    fontWeight?: string;
    textAlign?: 'left' | 'center' | 'right';
}

type InvoiceItem = {
    id?: string;
    type: string;
    content?: string;
    logo?: string;
    businessDetails?: string;
    style?: InvoiceItemStyle;
    children?: string[];
};

type InvoiceLayoutItem = { i: string; x: number; y: number; w: number; h: number };

const toNumber = (val: unknown) => {
    const parsed = Number(val ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const cleanFileName = (value: string) =>
    String(value || 'Invoice')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'Invoice';

const cleanText = (value: unknown) => String(value ?? '').replace(/[\t\r]+/g, ' ').trim();

const DESIGN_WIDTH_PX = 794;
const GRID_COLS = 12;
const GRID_ROW_HEIGHT_PX = 30;
const GRID_MARGIN_X_PX = 16;
const GRID_MARGIN_Y_PX = 8;
const PAGE_PADDING_MM = 8;
const FULL_WIDTH_THRESHOLD_COLS = 11;
const FOOTER_RESERVED_MM = 30;
const PDF_DEBUG_LAYOUT = false;

interface BoxMm {
    x: number;
    y: number;
    w: number;
    h: number;
}

const FOOTER_BOTTOM_MARGIN_MM = 8;
const MAX_INVOICE_IMAGE_BYTES = 2 * 1024 * 1024;

const toDataUrl = async (url: string): Promise<string | null> => {
    try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) return null;
        const contentLength = Number(response.headers.get('content-length') || '0');
        if (Number.isFinite(contentLength) && contentLength > MAX_INVOICE_IMAGE_BYTES) {
            return null;
        }
        const blob = await response.blob();
        if (blob.size > MAX_INVOICE_IMAGE_BYTES) {
            return null;
        }
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result === 'string') resolve(reader.result);
                else reject(new Error('Invalid image data'));
            };
            reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
};

export async function generateVectorInvoicePDF(
    order: InvoiceOrderData,
    layout: InvoiceLayoutItem[],
    items: InvoiceItem[],
    templateName: string,
    settings?: Record<string, unknown>
): Promise<void> {
    const mergedSettings = mergeInvoiceSettings(settings || {});
    const currency = order.currency || mergedSettings.locale.currency || 'USD';
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = PAGE_PADDING_MM;
    const contentWidth = pageWidth - margin * 2;
    const usablePageHeight = pageHeight - (PAGE_PADDING_MM * 2);
    const pxToMm = contentWidth / DESIGN_WIDTH_PX;
    const colWidthPx = (DESIGN_WIDTH_PX - (GRID_COLS - 1) * GRID_MARGIN_X_PX) / GRID_COLS;
    const rowSpanPx = GRID_ROW_HEIGHT_PX + GRID_MARGIN_Y_PX;

    const orderNumber = String(order.number || order.order_number || order.id || 'N/A');
    const orderDate = order.date_created
        ? new Date(order.date_created).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : 'N/A';

    const formatMoney = (value: unknown) => formatInvoiceCurrency(toNumber(value), mergedSettings, currency);

    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);

    const layoutById = new Map(layout.map((entry) => [entry.i, entry]));
    const itemById = new Map(items.filter((item) => item.id).map((item) => [item.id as string, item]));

    const toBoxMm = (entry: InvoiceLayoutItem): BoxMm => {
        const xPx = entry.x * (colWidthPx + GRID_MARGIN_X_PX);
        const yPx = entry.y * rowSpanPx;
        const wPx = entry.w * colWidthPx + Math.max(0, entry.w - 1) * GRID_MARGIN_X_PX;
        const hPx = entry.h * GRID_ROW_HEIGHT_PX + Math.max(0, entry.h - 1) * GRID_MARGIN_Y_PX;
        return {
            x: margin + (xPx * pxToMm),
            y: margin + (yPx * pxToMm),
            w: wPx * pxToMm,
            h: hPx * pxToMm,
        };
    };

    const sortedLayout = [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const normalizeLayoutItem = (entry: InvoiceLayoutItem, itemType?: string): InvoiceLayoutItem => {
        let x = Math.max(0, Math.min(GRID_COLS - 1, entry.x));
        let w = Math.max(1, Math.min(GRID_COLS, entry.w));
        if (x + w > GRID_COLS) {
            w = GRID_COLS - x;
        }

        if (itemType === 'order_table' && w >= FULL_WIDTH_THRESHOLD_COLS) {
            x = 0;
            w = GRID_COLS;
        }

        return {
            ...entry,
            x,
            w,
            y: Math.max(0, entry.y),
            h: Math.max(1, entry.h),
        };
    };

    const logoCache = new Map<string, string>();

    const billing = order.billing || {};
    const ensurePageForY = (yMm: number): { page: number; y: number } => {
        const normalized = Math.max(0, yMm - margin);
        const page = Math.max(1, Math.floor(normalized / usablePageHeight) + 1);
        while (doc.getNumberOfPages() < page) doc.addPage();
        const pageStart = margin + ((page - 1) * usablePageHeight);
        return { page, y: yMm - pageStart + margin };
    };

    const getPageTopGlobalY = (page: number): number => margin + ((page - 1) * usablePageHeight);

    const getPageBottomY = (): number => pageHeight - PAGE_PADDING_MM;

    const getWrappedTextHeight = (text: string, width: number, fontSize: number): number => {
        const lines = text
            .split('\n')
            .flatMap((line) => doc.splitTextToSize(line || ' ', Math.max(5, width - 1.5)));
        return lines.length * (fontSize * 0.36);
    };

    const drawDebugBox = (box: BoxMm, page: number, label: string): void => {
        if (!PDF_DEBUG_LAYOUT) return;
        const pageTop = getPageTopGlobalY(page);
        const yOnPage = box.y - pageTop + margin;
        doc.setPage(page);
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.1);
        doc.rect(box.x, yOnPage, box.w, box.h);
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.text(label, box.x + 1, yOnPage + 2.5);
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
    };

    const renderTextBlock = (rawText: string, box: BoxMm, style?: InvoiceItemStyle, align: 'left' | 'center' | 'right' = 'left') => {
        const text = rawText.trim();
        if (!text) return;
        const fontSize = Number.parseInt(style?.fontSize || '11', 10);
        const appliedFontSize = Number.isFinite(fontSize) ? Math.max(8, Math.min(fontSize, 18)) : 11;
        doc.setFont('helvetica', style?.fontWeight === 'bold' ? 'bold' : 'normal');
        doc.setFontSize(appliedFontSize);

        const lines = text
            .split('\n')
            .flatMap((line) => doc.splitTextToSize(line || ' ', Math.max(5, box.w - 1.5)));

        const pageInfo = ensurePageForY(box.y);
        doc.setPage(pageInfo.page);
        doc.text(lines, align === 'right' ? box.x + box.w : align === 'center' ? box.x + (box.w / 2) : box.x, pageInfo.y + 3.8, {
            align,
            baseline: 'top',
            maxWidth: Math.max(5, box.w - 1.5),
        });
    };

    const lineItems = order.line_items || [];
    const itemRows = lineItems.map((item) => {
        const quantity = toNumber(item.quantity);
        const lineTotal = toNumber(item.total);
        const unitPrice = quantity > 0 ? lineTotal / quantity : 0;
        const meta = getInvoiceItemMeta(item)
            .map((entry) => {
                const normalizedValue = String(entry.value || '').replace(/\s\|\s/g, '\n');
                return `${entry.label}: ${normalizedValue}`;
            })
            .join('\n');
        const description = [cleanText(item.name), meta].filter(Boolean).join('\n');

        return [
            description,
            String(quantity),
            formatMoney(unitPrice),
            formatMoney(lineTotal),
        ];
    });

    let afterTableGlobalY = 0;

    let footerItem: InvoiceItem | null = null;
    let footerBox: BoxMm | null = null;

    for (const layoutItemRaw of sortedLayout) {
        const baseItem = itemById.get(layoutItemRaw.i);
        const layoutItem = normalizeLayoutItem(layoutItemRaw, baseItem?.type);
        const item = itemById.get(layoutItem.i);
        if (!item) continue;
        const box = toBoxMm(layoutItem);
        const pageInfo = ensurePageForY(box.y);
        doc.setPage(pageInfo.page);
        drawDebugBox(box, pageInfo.page, item.type);

        if (PDF_DEBUG_LAYOUT) {
            console.log('[InvoiceVectorLayout]', {
                type: item.type,
                grid: { x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h },
                mm: { x: Number(box.x.toFixed(2)), y: Number(box.y.toFixed(2)), w: Number(box.w.toFixed(2)), h: Number(box.h.toFixed(2)) },
            });
        }

        if (item.type === 'header') {
            const logoDataUrl = item.logo ? (logoCache.get(item.logo) || await toDataUrl(item.logo)) : null;
            if (item.logo && logoDataUrl && !logoCache.has(item.logo)) logoCache.set(item.logo, logoDataUrl);
            if (logoDataUrl) {
                try {
                    doc.addImage(logoDataUrl, 'PNG', box.x + 1, pageInfo.y + 1, Math.min(34, box.w * 0.35), Math.min(box.h - 2, 16), undefined, 'FAST');
                } catch {
                    // Ignore image parsing errors
                }
            }
            const headerRight = cleanText(item.businessDetails);
            if (headerRight) {
                renderTextBlock(headerRight, { x: box.x + (box.w * 0.42), y: box.y, w: box.w * 0.58, h: box.h }, { fontSize: '10' }, 'right');
            }
            continue;
        }

        if (item.type === 'text') {
            const resolved = resolveInvoiceTemplateString(String(item.content || ''), order as Record<string, unknown>);
            renderTextBlock(resolved, box, item.style, item.style?.textAlign || 'left');
            continue;
        }

        if (item.type === 'customer_details') {
            const lines = [
                'Bill To',
                cleanText(`${billing.first_name || ''} ${billing.last_name || ''}`),
                cleanText(billing.company),
                cleanText(billing.address_1),
                cleanText(billing.address_2),
                cleanText(`${billing.city || ''}${billing.city && billing.state ? ', ' : ''}${billing.state || ''} ${billing.postcode || ''}`),
                cleanText(billing.country),
                cleanText(billing.email),
                cleanText(billing.phone),
            ].filter(Boolean).join('\n');
            renderTextBlock(lines, box, { fontSize: '10', fontWeight: 'normal' }, 'left');
            continue;
        }

        if (item.type === 'order_details') {
            const giftWrapMeta = getOrderGiftWrappingMeta(order as Record<string, unknown>);
            const detailRows: Array<{ label: string; value: string; highlight: boolean }> = [
                { label: 'Order Number', value: orderNumber, highlight: false },
                { label: 'Order Date', value: orderDate, highlight: false },
                { label: 'Payment Method', value: String(order.payment_method_title || order.payment_method || 'N/A'), highlight: false },
                { label: 'Shipping Method', value: String(order.shipping_lines?.[0]?.method_title || order.shipping_method || 'N/A'), highlight: false },
            ];
            if (giftWrapMeta) {
                detailRows.push({ label: giftWrapMeta.label, value: giftWrapMeta.value, highlight: true });
            }

            const baseFontSize = 9.5;
            const rowHeight = baseFontSize * 0.6;
            let rowY = pageInfo.y + 3.8;
            doc.setFontSize(baseFontSize);
            for (const row of detailRows) {
                if (row.highlight) {
                    doc.setFillColor(254, 240, 138);
                    doc.rect(box.x + 0.2, rowY - (rowHeight * 0.8), Math.max(10, box.w - 0.4), rowHeight + 1.6, 'F');
                }
                doc.setTextColor(0, 0, 0);
                doc.setFont('helvetica', 'normal');
                doc.text(`${row.label}:`, box.x + 0.6, rowY, { baseline: 'top' });
                doc.setFont('helvetica', 'bold');
                doc.text(row.value, box.x + (box.w * 0.42), rowY, {
                    baseline: 'top',
                    maxWidth: Math.max(8, box.w * 0.56),
                });
                rowY += rowHeight + 1.1;
            }
            continue;
        }

        if (item.type === 'order_table') {
            const reservedBottomY = getPageBottomY() - FOOTER_RESERVED_MM;
            const startY = Math.min(pageInfo.y, reservedBottomY);
            autoTable(doc, {
                startY,
                margin: { left: box.x, right: pageWidth - (box.x + box.w) },
                tableWidth: box.w,
                theme: 'plain',
                head: [['Description', 'Qty', 'Unit Price', 'Total']],
                body: itemRows.length > 0 ? itemRows : [['No line items', '', '', '']],
                styles: {
                    font: 'helvetica',
                    fontSize: 9.2,
                    cellPadding: 1.5,
                    textColor: [0, 0, 0],
                    lineColor: [255, 255, 255],
                    lineWidth: 0,
                    valign: 'middle',
                },
                headStyles: {
                    fillColor: [255, 255, 255],
                    textColor: [0, 0, 0],
                    lineColor: [255, 255, 255],
                    lineWidth: 0,
                    fontStyle: 'bold',
                },
                columnStyles: {
                    0: { cellWidth: box.w * 0.58, halign: 'left' },
                    1: { cellWidth: box.w * 0.12, halign: 'center' },
                    2: { cellWidth: box.w * 0.15, halign: 'right' },
                    3: { cellWidth: box.w * 0.15, halign: 'right' },
                },
            });
            const tablePage = (doc as jsPDF & { lastAutoTable?: { pageNumber?: number; finalY?: number } }).lastAutoTable?.pageNumber || pageInfo.page;
            const tableFinalY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || pageInfo.y;
            afterTableGlobalY = ((tablePage - 1) * pageHeight) + tableFinalY;
            continue;
        }

        if (item.type === 'totals') {
            // handled after order_table to keep alignment
            continue;
        }

        if (item.type === 'payment_block') {
            const payText = cleanText(item.content || mergedSettings.payment.payNowUrl || '');
            if (payText) renderTextBlock('Payment\nScan to pay', box, { fontSize: '9.5' }, 'left');
            continue;
        }

        if (item.type === 'footer') {
            footerItem = item;
            footerBox = box;
            continue;
        }

        if (item.type === 'row' && item.children?.length) {
            const childText = item.children
                .map((childId) => itemById.get(childId))
                .filter((child): child is InvoiceItem => Boolean(child))
                .map((child) => cleanText(resolveInvoiceTemplateString(String(child.content || ''), order as Record<string, unknown>)))
                .filter(Boolean)
                .join('    ');
            if (childText) renderTextBlock(childText, box, { fontSize: '10' }, 'left');
        }
    }

    const afterTableY = afterTableGlobalY > 0 ? afterTableGlobalY : 0;
    const subtotal = toNumber(order.total) - toNumber(order.total_tax) - toNumber(order.shipping_total);
    const totalsRows = [
        ['Subtotal', formatMoney(subtotal)],
        ...(toNumber(order.shipping_total) > 0 ? [['Shipping', formatMoney(order.shipping_total)]] : []),
        ...(toNumber(order.discount_total) > 0 ? [['Discount', `-${formatMoney(order.discount_total)}`]] : []),
        ['Tax', formatMoney(order.total_tax)],
        ['Total', formatMoney(order.total)],
    ];

    const totalsItem = items.find((entry) => entry.type === 'totals' && entry.id && layoutById.has(entry.id));
    const totalsLayoutBase = totalsItem?.id ? layoutById.get(totalsItem.id) : undefined;
    const totalsLayout = totalsLayoutBase && totalsItem ? normalizeLayoutItem(totalsLayoutBase, totalsItem.type) : undefined;
    const totalsBox = totalsLayout ? toBoxMm(totalsLayout) : { x: pageWidth - 70, y: afterTableY + 3, w: 66, h: 36 };
    const totalsPageInfo = ensurePageForY(Math.max(afterTableY + 3, totalsBox.y));
    doc.setPage(totalsPageInfo.page);
    drawDebugBox(totalsBox, totalsPageInfo.page, 'totals');

    autoTable(doc, {
        startY: totalsPageInfo.y,
        margin: { left: totalsBox.x, right: pageWidth - (totalsBox.x + totalsBox.w) },
        theme: 'plain',
        body: totalsRows,
        styles: {
            font: 'helvetica',
            fontSize: 9.8,
            textColor: [0, 0, 0],
            cellPadding: 1.1,
            lineColor: [0, 0, 0],
            lineWidth: 0,
        },
        columnStyles: {
            0: { halign: 'right', cellWidth: 32 },
            1: { halign: 'right', cellWidth: 38 },
        },
        didParseCell: (hook) => {
            if (hook.row.index === totalsRows.length - 1) {
                hook.cell.styles.fontStyle = 'bold';
                hook.cell.styles.fontSize = 11;
            }
        },
        willDrawCell: (hook) => {
            if (hook.row.index === totalsRows.length - 1) {
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.12);
                doc.line(hook.table.settings.margin.left, hook.cell.y - 0.8, hook.table.settings.margin.left + totalsBox.w, hook.cell.y - 0.8);
            }
        },
    });

    if (footerItem && footerBox) {
        const footerText = cleanText(footerItem.content || mergedSettings.compliance.legalFooter || 'Thank you for your business!');
        const totalsPage = (doc as jsPDF & { lastAutoTable?: { pageNumber?: number } }).lastAutoTable?.pageNumber || totalsPageInfo.page;
        const totalsFinalY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || totalsPageInfo.y;
        const minFooterYGlobal = ((totalsPage - 1) * pageHeight) + totalsFinalY + 4;
        const footerYGlobal = Math.max(footerBox.y, minFooterYGlobal);
        const footerPageInfo = ensurePageForY(footerYGlobal);
        const footerFontSize = 9;
        const footerHeight = getWrappedTextHeight(footerText, footerBox.w, footerFontSize);
        const maxFooterTop = pageHeight - FOOTER_BOTTOM_MARGIN_MM - footerHeight;
        const clampedFooterY = Math.min(footerPageInfo.y, maxFooterTop);
        drawDebugBox({ x: footerBox.x, y: ((footerPageInfo.page - 1) * pageHeight) + clampedFooterY, w: footerBox.w, h: footerBox.h }, footerPageInfo.page, 'footer');
        renderTextBlock(
            footerText,
            { x: footerBox.x, y: ((footerPageInfo.page - 1) * pageHeight) + clampedFooterY, w: footerBox.w, h: footerBox.h },
            { fontSize: String(footerFontSize), textAlign: 'center' },
            'center'
        );
    }

    const safeTemplateName = cleanFileName(templateName || 'Invoice');
    const safeOrderNumber = cleanFileName(String(orderNumber));
    doc.save(`${safeTemplateName}_${safeOrderNumber}.pdf`);
}
