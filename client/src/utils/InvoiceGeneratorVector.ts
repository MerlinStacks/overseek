import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    buildInvoiceNumber,
    formatInvoiceCurrency,
    formatInvoiceDate,
    mergeInvoiceSettings,
    resolveInvoiceTemplateString,
} from '../../../packages/overseek-core/src/invoiceRenderModel';
import { getInvoiceItemMeta } from '../../../packages/overseek-core/src/invoiceItemUtils';

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

interface BoxMm {
    x: number;
    y: number;
    w: number;
    h: number;
}

const toDataUrl = async (url: string): Promise<string | null> => {
    try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) return null;
        const blob = await response.blob();
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
    const margin = 0;
    const contentWidth = pageWidth - margin * 2;
    const pxToMm = pageWidth / DESIGN_WIDTH_PX;
    const colWidthPx = (DESIGN_WIDTH_PX - (GRID_COLS - 1) * GRID_MARGIN_X_PX) / GRID_COLS;
    const rowSpanPx = GRID_ROW_HEIGHT_PX + GRID_MARGIN_Y_PX;

    const invoiceNumber = buildInvoiceNumber(mergedSettings);
    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + Number(mergedSettings.compliance.paymentTermsDays || 14));

    const orderNumber = order.number || order.order_number || order.id || 'N/A';
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
        return { x: xPx * pxToMm, y: yPx * pxToMm, w: wPx * pxToMm, h: hPx * pxToMm };
    };

    const sortedLayout = [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x));

    const logoCache = new Map<string, string>();

    const billing = order.billing || {};
    const billTo = [
        cleanText(`${billing.first_name || ''} ${billing.last_name || ''}`),
        cleanText(billing.company),
        cleanText(billing.address_1),
        cleanText(billing.address_2),
        cleanText(`${billing.city || ''}${billing.city && billing.state ? ', ' : ''}${billing.state || ''} ${billing.postcode || ''}`),
        cleanText(billing.country),
        cleanText(billing.email),
        cleanText(billing.phone),
    ].filter(Boolean);

    const ensurePageForY = (yMm: number): { page: number; y: number } => {
        const page = Math.max(1, Math.floor(yMm / pageHeight) + 1);
        while (doc.getNumberOfPages() < page) doc.addPage();
        return { page, y: yMm - ((page - 1) * pageHeight) };
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
            .map((entry) => `${entry.label}: ${entry.value}`)
            .join(' | ');
        const description = [cleanText(item.name), meta].filter(Boolean).join('\n');

        return [
            description,
            String(quantity),
            formatMoney(unitPrice),
            formatMoney(lineTotal),
        ];
    });

    let afterTableGlobalY = 0;

    for (const layoutItem of sortedLayout) {
        const item = itemById.get(layoutItem.i);
        if (!item) continue;
        const box = toBoxMm(layoutItem);
        const pageInfo = ensurePageForY(box.y);
        doc.setPage(pageInfo.page);

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
            const lines = [
                `Invoice Number: ${invoiceNumber}`,
                `Invoice Date: ${formatInvoiceDate(issueDate, mergedSettings)}`,
                `Due Date: ${formatInvoiceDate(dueDate, mergedSettings)}`,
                `Order Number: ${orderNumber}`,
                `Order Date: ${orderDate}`,
                `Payment Method: ${order.payment_method_title || order.payment_method || 'N/A'}`,
                `Shipping Method: ${order.shipping_lines?.[0]?.method_title || order.shipping_method || 'N/A'}`,
            ].join('\n');
            renderTextBlock(lines, box, { fontSize: '9.5' }, 'left');
            continue;
        }

        if (item.type === 'order_table') {
            autoTable(doc, {
                startY: pageInfo.y,
                margin: { left: box.x, right: pageWidth - (box.x + box.w) },
                theme: 'grid',
                head: [['Description', 'Qty', 'Unit Price', 'Total']],
                body: itemRows.length > 0 ? itemRows : [['No line items', '', '', '']],
                styles: {
                    font: 'helvetica',
                    fontSize: 9.2,
                    cellPadding: 1.5,
                    textColor: [0, 0, 0],
                    lineColor: [0, 0, 0],
                    lineWidth: 0.08,
                    valign: 'middle',
                },
                headStyles: {
                    fillColor: [255, 255, 255],
                    textColor: [0, 0, 0],
                    lineColor: [0, 0, 0],
                    lineWidth: 0.15,
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
            if (payText) renderTextBlock(`Payment\n${payText}`, box, { fontSize: '9.5' }, 'left');
            continue;
        }

        if (item.type === 'footer') {
            const footerText = cleanText(item.content || mergedSettings.compliance.legalFooter || 'Thank you for your business!');
            renderTextBlock(footerText, box, { fontSize: '9', textAlign: 'center' }, 'center');
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
    const totalsLayout = totalsItem?.id ? layoutById.get(totalsItem.id) : undefined;
    const totalsBox = totalsLayout ? toBoxMm(totalsLayout) : { x: pageWidth - 70, y: afterTableY + 3, w: 66, h: 36 };
    const totalsPageInfo = ensurePageForY(Math.max(afterTableY + 3, totalsBox.y));
    doc.setPage(totalsPageInfo.page);

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

    const safeTemplateName = cleanFileName(templateName || 'Invoice');
    const safeOrderNumber = cleanFileName(String(orderNumber));
    doc.save(`${safeTemplateName}_${safeOrderNumber}.pdf`);
}
