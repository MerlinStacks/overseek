import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    buildInvoiceNumber,
    formatInvoiceCurrency,
    formatInvoiceDate,
    mergeInvoiceSettings,
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

type InvoiceItem = { type: string; content?: string; businessDetails?: string };

const toNumber = (val: unknown) => {
    const parsed = Number(val ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const cleanFileName = (value: string) =>
    String(value || 'Invoice')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'Invoice';

const cleanText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function generateVectorInvoicePDF(
    order: InvoiceOrderData,
    items: InvoiceItem[],
    templateName: string,
    settings?: Record<string, unknown>
): void {
    const mergedSettings = mergeInvoiceSettings(settings || {});
    const currency = order.currency || mergedSettings.locale.currency || 'USD';
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;

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

    const headerItem = items.find((item) => item.type === 'header');
    const footerItem = items.find((item) => item.type === 'footer');
    const paymentItem = items.find((item) => item.type === 'payment_block');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(cleanText(templateName || 'Invoice').toUpperCase(), margin, margin + 2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const businessDetails = cleanText(headerItem?.businessDetails);
    if (businessDetails) {
        const lines = doc.splitTextToSize(businessDetails, 70);
        doc.text(lines, pageWidth - margin, margin, { align: 'right', baseline: 'top' });
    }

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

    let cursorY = margin + 22;

    const billToText = ['Bill To', ...billTo].join('\n');
    const invoiceFactsText = [
        `Invoice Number: ${invoiceNumber}`,
        `Invoice Date: ${formatInvoiceDate(issueDate, mergedSettings)}`,
        `Due Date: ${formatInvoiceDate(dueDate, mergedSettings)}`,
        `Order Number: ${orderNumber}`,
        `Order Date: ${orderDate}`,
        `Payment Method: ${order.payment_method_title || order.payment_method || 'N/A'}`,
        `Shipping Method: ${order.shipping_lines?.[0]?.method_title || order.shipping_method || 'N/A'}`,
    ].join('\n');

    autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin },
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9.5, textColor: 20, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0 },
        columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: contentWidth - 95 } },
        body: [[billToText, invoiceFactsText]],
        didParseCell: (data) => {
            if (data.column.index === 1) {
                data.cell.styles.halign = 'right';
            }
            if (data.column.index === 0) {
                data.cell.styles.fontStyle = 'bold';
            }
        },
    });

    cursorY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || cursorY;
    cursorY += 4;

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

    autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin },
        theme: 'grid',
        head: [['Description', 'Qty', 'Unit Price', 'Total']],
        body: itemRows.length > 0 ? itemRows : [['No line items', '', '', '']],
        styles: {
            font: 'helvetica',
            fontSize: 9.4,
            cellPadding: 1.6,
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
            0: { cellWidth: contentWidth - 74, halign: 'left' },
            1: { cellWidth: 16, halign: 'center' },
            2: { cellWidth: 28, halign: 'right' },
            3: { cellWidth: 30, halign: 'right' },
        },
        didDrawPage: () => {
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.12);
            doc.line(margin, margin + 9, pageWidth - margin, margin + 9);
        },
    });

    const afterTableY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || cursorY;
    const subtotal = toNumber(order.total) - toNumber(order.total_tax) - toNumber(order.shipping_total);
    const totalsRows = [
        ['Subtotal', formatMoney(subtotal)],
        ...(toNumber(order.shipping_total) > 0 ? [['Shipping', formatMoney(order.shipping_total)]] : []),
        ...(toNumber(order.discount_total) > 0 ? [['Discount', `-${formatMoney(order.discount_total)}`]] : []),
        ['Tax', formatMoney(order.total_tax)],
        ['Total', formatMoney(order.total)],
    ];

    autoTable(doc, {
        startY: afterTableY + 3,
        margin: { left: pageWidth - margin - 70, right: margin },
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
                doc.line(hook.table.settings.margin.left, hook.cell.y - 0.8, pageWidth - margin, hook.cell.y - 0.8);
            }
        },
    });

    const footerText = cleanText(footerItem?.content || mergedSettings.compliance.legalFooter || 'Thank you for your business.');
    const paymentText = cleanText(paymentItem?.content || mergedSettings.payment.payNowUrl);
    const footerLines = [paymentText ? `Payment: ${paymentText}` : '', footerText].filter(Boolean);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.text(footerLines.join('  |  '), pageWidth / 2, pageHeight - 8, { align: 'center', baseline: 'bottom' });

    const safeTemplateName = cleanFileName(templateName || 'Invoice');
    const safeOrderNumber = cleanFileName(String(orderNumber));
    doc.save(`${safeTemplateName}_${safeOrderNumber}.pdf`);
}
