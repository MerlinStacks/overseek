import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import {
    DEFAULT_INVOICE_TEMPLATE_SETTINGS,
    formatInvoiceCurrency,
    formatInvoiceDate,
    mergeInvoiceSettings,
    resolveInvoiceTemplateString,
} from '../../../packages/overseek-core/dist/invoiceRenderModel';
import {
    decodeInvoiceEntities,
    getInvoiceItemMeta,
} from '../../../packages/overseek-core/dist/invoiceItemUtils';
import { Logger } from '../utils/logger';

type InvoiceGridItem = {
    x?: number;
    y?: number;
    w?: number;
    i: string;
    [key: string]: unknown;
};
type InvoiceItemConfig = {
    type?: string;
    id?: string;
    content?: string;
    style?: { fontSize?: string | number; fontWeight?: string; textAlign?: string };
    businessDetails?: string;
    logo?: string;
    orderDetailsFields?: string[];
    children?: string[];
    [key: string]: unknown;
};
type InvoiceTemplateSettings = {
    locale?: { currency?: string; [key: string]: unknown };
    numbering?: { [key: string]: unknown };
    compliance?: { taxIdValue?: string; taxIdLabel?: string; legalFooter?: string; [key: string]: unknown };
    payment?: { payNowLabel?: string; [key: string]: unknown };
    branding?: { primaryColor?: string; [key: string]: unknown };
    [key: string]: unknown;
};
type InvoiceTemplateVersionLayout = {
    grid: InvoiceGridItem[];
    items: InvoiceItemConfig[];
    settings: InvoiceTemplateSettings;
};
type InvoiceTemplateVersion = {
    id: string;
    createdAt: string;
    name: string;
    layout: InvoiceTemplateVersionLayout;
};
type InvoiceTemplateLayout = {
    grid: InvoiceGridItem[];
    items: InvoiceItemConfig[];
    settings: InvoiceTemplateSettings;
    versions: InvoiceTemplateVersion[];
};
type InvoiceOrder = Record<string, unknown> & {
    rawData?: Record<string, unknown>;
    number?: string;
    paymentMethod?: string;
    createdAt?: Date | string;
    taxTotal?: string | number;
    shippingTotal?: string | number;
    total?: string | number;
};
type InvoiceBilling = {
    first_name?: string;
    last_name?: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    email?: string;
    phone?: string;
    [key: string]: unknown;
};
type InvoiceLineItem = {
    name?: string;
    quantity?: number;
    total?: string | number;
    [key: string]: unknown;
};
type InvoiceTemplate = Record<string, unknown> & { layout?: unknown };

export class InvoicePdfRenderer {
    render(
        filePath: string,
        order: InvoiceOrder,
        billing: InvoiceBilling,
        lineItems: InvoiceLineItem[],
        template: InvoiceTemplate,
        normalizedLayout?: InvoiceTemplateLayout,
        invoiceContext?: {
            number: string;
            issueDate: string;
            dueDate: string;
            paymentTermsDays: number;
            paymentUrl?: string;
            paymentQrBuffer?: Buffer | null;
        }
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const stream = fs.createWriteStream(filePath);

            doc.on('error', reject);
            doc.pipe(stream);

            // Parse template layout
            let layoutDataRaw: unknown = normalizedLayout || template.layout;
            let layoutData: Record<string, unknown> = (layoutDataRaw as Record<string, unknown>) || {};
            Logger.info('Template layout raw type', { type: typeof layoutDataRaw, hasLayout: !!layoutDataRaw });

            if (typeof layoutDataRaw === 'string') {
                try {
                    // Guard: pathologically large template strings can OOM during parse
                    if (layoutDataRaw.length > 10 * 1024 * 1024) {
                        Logger.warn('[InvoicePdfRenderer] Layout data string exceeds safe size, skipping parse', {
                            sizeMB: (layoutDataRaw.length / 1024 / 1024).toFixed(2)
                        });
                    } else {
                        layoutData = JSON.parse(layoutDataRaw) as Record<string, unknown>;
                        Logger.info('Parsed layout from string');
                    }
                } catch (e) {
                    Logger.error('Failed to parse template layout', { error: e });
                }
            }

            const grid = Array.isArray(layoutData?.grid) ? layoutData.grid as InvoiceGridItem[] : [];
            const items = Array.isArray(layoutData?.items) ? layoutData.items as InvoiceItemConfig[] : [];
            const rawSettings = layoutData?.settings && typeof layoutData.settings === 'object' ? layoutData.settings as InvoiceTemplateSettings : DEFAULT_INVOICE_TEMPLATE_SETTINGS;
            const settings = mergeInvoiceSettings(rawSettings);
            const localeSettings = settings.locale as InvoiceTemplateSettings['locale'] & { currency?: string } || {};
            const complianceSettings = settings.compliance as InvoiceTemplateSettings['compliance'] & { taxIdValue?: string; taxIdLabel?: string; legalFooter?: string } || {};
            const paymentSettings = settings.payment as InvoiceTemplateSettings['payment'] & { payNowLabel?: string } || {};
            const brandingSettings = settings.branding as InvoiceTemplateSettings['branding'] & { primaryColor?: string } || {};

            Logger.info('Template layout extracted', {
                gridCount: grid.length,
                itemsCount: items.length,
                itemTypes: items.map((i: InvoiceItemConfig) => i.type)
            });

            // Helpers — use Intl.NumberFormat with order currency for consistency with HTML preview
            const orderRawData = (order.rawData as Record<string, unknown>) || {};
            const orderCurrency = (typeof orderRawData.currency === 'string' ? orderRawData.currency : '') || (localeSettings.currency as string) || 'AUD';
            const formatCurrency = (val: unknown) => {
                return formatInvoiceCurrency(parseFloat(String(val ?? 0)), settings, orderCurrency);
            };
            const formatDate = (d: Date) => formatInvoiceDate(d, settings);

            const rawData = orderRawData;

            // Page dimensions (A4 with 50pt margins)
            const pageWidth = 495; // 595 - 100 (margins)
            const colWidth = pageWidth / 12;
            const rowHeight = 30;
            const marginLeft = 50;
            const marginTop = 50;
            const pageHeight = 742;
            const rowsPerPage = Math.max(1, Math.floor(pageHeight / rowHeight));

            // Sort grid items by Y position
            const sortedGrid = [...grid].sort((a, b) => (Number(a.y) - Number(b.y)) || (Number(a.x) - Number(b.x)));

            // Find item config by ID
            const getItemConfig = (id: string) => items.find((i) => String(i.id) === id);

            let currentPageIndex = 0;
            const ensurePage = (targetIndex: number) => {
                while (currentPageIndex < targetIndex) {
                    doc.addPage();
                    currentPageIndex += 1;
                }
            };

            // Render a single block
            const renderBlock = (itemConfig: InvoiceItemConfig, x: number, width: number, startY: number): number => {
                if (!itemConfig) return 0;

                let blockHeight = 0;
                const type = itemConfig.type;

                switch (type) {
                    case 'header': {
                        // Header with logo and business details
                        doc.fontSize(10);
                        if (itemConfig.businessDetails && typeof itemConfig.businessDetails === 'string') {
                            const lines = itemConfig.businessDetails.split('\n');
                            lines.forEach((line, idx) => {
                                doc.text(line, x + width - 200, startY + (idx * 12), { width: 200, align: 'right' });
                            });
                            blockHeight = Math.max(blockHeight, lines.length * 12 + 10);
                        }
                        if (complianceSettings?.taxIdValue) {
                            const taxLabel = complianceSettings.taxIdLabel || 'Tax ID';
                            doc.font('Helvetica-Bold').fontSize(9);
                            doc.text(`${taxLabel}: ${complianceSettings.taxIdValue}`, x + width - 200, startY + blockHeight, { width: 200, align: 'right' });
                            doc.font('Helvetica').fontSize(10);
                            blockHeight += 14;
                        }
                        if (itemConfig.logo) {
                            try {
                                // Resolve relative URL to local file path
                                const logoUrl: string = itemConfig.logo;
                                if (logoUrl.startsWith('/uploads/')) {
                                    const localPath = path.join(__dirname, '../../', logoUrl);
                                    if (fs.existsSync(localPath)) {
                                        doc.image(localPath, x, startY, { width: 120, height: 60, fit: [120, 60] });
                                    } else {
                                        Logger.warn('Logo file not found on disk', { logoUrl, localPath });
                                    }
                                }
                            } catch (e) {
                                Logger.warn('Failed to render logo in PDF', { error: e });
                            }
                        }
                        blockHeight = Math.max(blockHeight, 60);
                        break;
                    }

                    case 'customer_details': {
                        doc.fontSize(10).font('Helvetica-Bold');
                        doc.text('Bill To:', x, startY);
                        doc.font('Helvetica').fontSize(9);
                        let custY = startY + 15;
                        if (billing.first_name || billing.last_name) {
                            doc.text(`${billing.first_name || ''} ${billing.last_name || ''}`, x, custY);
                            custY += 12;
                        }
                        if (billing.company) {
                            doc.text(billing.company, x, custY);
                            custY += 12;
                        }
                        if (billing.address_1) {
                            doc.text(billing.address_1, x, custY);
                            custY += 12;
                        }
                        if (billing.address_2) {
                            doc.text(billing.address_2, x, custY);
                            custY += 12;
                        }
                        if (billing.city || billing.state || billing.postcode) {
                            doc.text(`${billing.city || ''}${billing.city && billing.state ? ', ' : ''}${billing.state || ''} ${billing.postcode || ''}`, x, custY);
                            custY += 12;
                        }
                        if (billing.country) {
                            doc.text(billing.country, x, custY);
                            custY += 12;
                        }
                        if (billing.email) {
                            doc.fillColor('#4f46e5').text(billing.email, x, custY);
                            doc.fillColor('black');
                            custY += 12;
                        }
                        if (billing.phone) {
                            doc.text(billing.phone, x, custY);
                            custY += 12;
                        }
                        blockHeight = custY - startY + 10;
                        break;
                    }

                    case 'order_details': {
                        doc.fontSize(9);
                        const orderDetailsRaw = orderRawData || {};
                        const shippingLines = Array.isArray(orderDetailsRaw.shipping_lines) ? orderDetailsRaw.shipping_lines as Record<string, unknown>[] : [];
                        const shippingMethod = (shippingLines[0]?.method_title as string) || 'N/A';
                        const paymentMethod = (typeof orderDetailsRaw.payment_method_title === 'string' ? orderDetailsRaw.payment_method_title : '') || (typeof order.paymentMethod === 'string' ? order.paymentMethod : '') || 'N/A';
                        const orderDate = orderDetailsRaw.date_created
                            ? formatDate(new Date(String(orderDetailsRaw.date_created)))
                            : formatDate(order.createdAt as Date);

                        const allFields: Record<string, [string, string]> = {
                            invoice_number: ['Invoice Number:', invoiceContext?.number || 'N/A'],
                            invoice_date: ['Invoice Date:', invoiceContext?.issueDate || orderDate],
                            due_date: ['Due Date:', invoiceContext?.dueDate || orderDate],
                            order_number: ['Order Number:', String(order.number ?? '')],
                            order_date: ['Order Date:', orderDate],
                            payment_method: ['Payment Method:', paymentMethod],
                            shipping_method: ['Shipping Method:', shippingMethod]
                        };

                        const fieldKeys = Array.isArray(itemConfig.orderDetailsFields) ? itemConfig.orderDetailsFields as string[] : Object.keys(allFields);
                        const detailsData = fieldKeys.map((k) => allFields[k]).filter(Boolean) as [string, string][];

                        let detY = startY;
                        detailsData.forEach(([label, value]) => {
                            doc.font('Helvetica').fillColor('#64748b').text(label, x, detY, { continued: false });
                            doc.font('Helvetica-Bold').fillColor('black').text(value, x + 100, detY, { width: width - 120 });
                            detY += 14;
                        });
                        blockHeight = detY - startY + 10;
                        break;
                    }

                    case 'order_table': {
                        // Respect saved grid width/position so generated output follows designer layout.
                        doc.fontSize(9).font('Helvetica-Bold');
                        const tableX = x;
                        const fullTableWidth = width;
                        const descWidth = fullTableWidth * 0.55;
                        const qtyWidth = 40;
                        const priceWidth = 70;
                        const totalWidth = fullTableWidth - descWidth - qtyWidth - priceWidth;

                        doc.text('Description', tableX, startY);
                        doc.text('Qty', tableX + descWidth, startY, { width: qtyWidth, align: 'center' });
                        doc.text('Unit Price', tableX + descWidth + qtyWidth, startY, { width: priceWidth, align: 'right' });
                        doc.text('Total', tableX + descWidth + qtyWidth + priceWidth, startY, { width: totalWidth, align: 'right' });

                        doc.moveTo(tableX, startY + 12).lineTo(tableX + fullTableWidth, startY + 12).stroke();

                        let tableY = startY + 18;
                        doc.font('Helvetica').fontSize(9);

                        lineItems.forEach((item) => {
                            // Check for page break
                            if (tableY > 720) {
                                doc.addPage();
                                currentPageIndex += 1;
                                tableY = 50;
                                doc.fontSize(9).font('Helvetica-Bold');
                                doc.text('Description', tableX, tableY);
                                doc.text('Qty', tableX + descWidth, tableY, { width: qtyWidth, align: 'center' });
                                doc.text('Unit Price', tableX + descWidth + qtyWidth, tableY, { width: priceWidth, align: 'right' });
                                doc.text('Total', tableX + descWidth + qtyWidth + priceWidth, tableY, { width: totalWidth, align: 'right' });
                                doc.moveTo(tableX, tableY + 12).lineTo(tableX + fullTableWidth, tableY + 12).stroke();
                                tableY += 18;
                                doc.font('Helvetica').fontSize(9);
                            }

                            const itemName = item.name || 'Product';
                            const qty = item.quantity || 1;
                            const unitPrice = qty > 0 ? (parseFloat(String(item.total ?? 0)) / qty) : 0;

                            doc.text(itemName, tableX, tableY, { width: descWidth - 10 });
                            doc.text(String(qty), tableX + descWidth, tableY, { width: qtyWidth, align: 'center' });
                            doc.text(formatCurrency(unitPrice), tableX + descWidth + qtyWidth, tableY, { width: priceWidth, align: 'right' });
                            doc.text(formatCurrency(String(item.total ?? 0)), tableX + descWidth + qtyWidth + priceWidth, tableY, { width: totalWidth, align: 'right' });

                            const itemMeta = getInvoiceItemMeta(item);
                            if (itemMeta.length > 0) {
                                tableY += 12;
                                doc.fontSize(8).fillColor('#64748b');
                                itemMeta.slice(0, 6).forEach((meta) => {
                                    doc.text(
                                        decodeInvoiceEntities(`${meta.label}: ${meta.value}`),
                                        tableX + 10,
                                        tableY,
                                        { width: descWidth - 20 }
                                    );
                                    tableY += 10;
                                });
                                doc.fillColor('black').fontSize(9);
                            }

                            tableY += 14;
                        });

                        // Totals integrated into table — use rawData for consistency
                        doc.moveTo(tableX, tableY).lineTo(tableX + fullTableWidth, tableY).stroke();
                        tableY += 10;

                        const taxVal = Number(typeof orderRawData.total_tax === 'number' ? orderRawData.total_tax : (typeof orderRawData.total_tax === 'string' ? parseFloat(orderRawData.total_tax) : (typeof order.taxTotal === 'number' ? order.taxTotal : (typeof order.taxTotal === 'string' ? parseFloat(order.taxTotal) : 0)))) || 0;
                        const shipVal = Number(typeof orderRawData.shipping_total === 'number' ? orderRawData.shipping_total : (typeof orderRawData.shipping_total === 'string' ? parseFloat(orderRawData.shipping_total) : (typeof order.shippingTotal === 'number' ? order.shippingTotal : (typeof order.shippingTotal === 'string' ? parseFloat(order.shippingTotal) : 0)))) || 0;
                        const totalVal = Number(typeof orderRawData.total === 'number' ? orderRawData.total : (typeof orderRawData.total === 'string' ? parseFloat(orderRawData.total) : (typeof order.total === 'number' ? order.total : (typeof order.total === 'string' ? parseFloat(order.total) : 0)))) || 0;
                        const subtotal = totalVal - taxVal - shipVal;
                        const totalsX = tableX + fullTableWidth - 170;

                        doc.font('Helvetica').fontSize(9);
                        doc.text('Subtotal', totalsX, tableY);
                        doc.text(formatCurrency(subtotal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 14;

                        if (shipVal > 0) {
                            doc.text('Shipping', totalsX, tableY);
                            doc.text(formatCurrency(shipVal), totalsX + 80, tableY, { width: 70, align: 'right' });
                            tableY += 14;
                        }

                        const discountVal = Number(typeof orderRawData.discount_total === 'number' ? orderRawData.discount_total : (typeof orderRawData.discount_total === 'string' ? parseFloat(orderRawData.discount_total) : 0)) || 0;
                        if (discountVal > 0) {
                            doc.fillColor('#059669'); // emerald
                            doc.text('Discount', totalsX, tableY);
                            doc.text(`-${formatCurrency(discountVal)}`, totalsX + 80, tableY, { width: 70, align: 'right' });
                            tableY += 14;
                            doc.fillColor('black');
                        }

                        doc.text('Tax', totalsX, tableY);
                        doc.text(formatCurrency(taxVal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 16;

                        doc.font('Helvetica-Bold').fontSize(11);
                        doc.text('Total', totalsX, tableY);
                        doc.text(formatCurrency(totalVal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 20;

                        blockHeight = tableY - startY;
                        break;
                    }

                    case 'totals': {
                        // Standalone totals block — use rawData for consistency
                        const totTax = Number(typeof orderRawData.total_tax === 'number' ? orderRawData.total_tax : (typeof orderRawData.total_tax === 'string' ? parseFloat(orderRawData.total_tax) : (typeof order.taxTotal === 'number' ? order.taxTotal : (typeof order.taxTotal === 'string' ? parseFloat(order.taxTotal) : 0)))) || 0;
                        const totShip = Number(typeof orderRawData.shipping_total === 'number' ? orderRawData.shipping_total : (typeof orderRawData.shipping_total === 'string' ? parseFloat(orderRawData.shipping_total) : (typeof order.shippingTotal === 'number' ? order.shippingTotal : (typeof order.shippingTotal === 'string' ? parseFloat(order.shippingTotal) : 0)))) || 0;
                        const totTotal = Number(typeof orderRawData.total === 'number' ? orderRawData.total : (typeof orderRawData.total === 'string' ? parseFloat(orderRawData.total) : (typeof order.total === 'number' ? order.total : (typeof order.total === 'string' ? parseFloat(order.total) : 0)))) || 0;
                        const subtotalVal = totTotal - totTax - totShip;

                        doc.fontSize(9).font('Helvetica');

                        let totY = startY;
                        doc.text('Subtotal:', x, totY);
                        doc.text(formatCurrency(subtotalVal), x + 80, totY, { width: 70, align: 'right' });
                        totY += 14;

                        if (totShip > 0) {
                            doc.text('Shipping:', x, totY);
                            doc.text(formatCurrency(totShip), x + 80, totY, { width: 70, align: 'right' });
                            totY += 14;
                        }

                        const totDiscount = Number(typeof orderRawData.discount_total === 'number' ? orderRawData.discount_total : (typeof orderRawData.discount_total === 'string' ? parseFloat(orderRawData.discount_total) : 0)) || 0;
                        if (totDiscount > 0) {
                            doc.fillColor('#059669');
                            doc.text('Discount:', x, totY);
                            doc.text(`-${formatCurrency(totDiscount)}`, x + 80, totY, { width: 70, align: 'right' });
                            totY += 14;
                            doc.fillColor('black');
                        }

                        doc.text('Tax:', x, totY);
                        doc.text(formatCurrency(totTax), x + 80, totY, { width: 70, align: 'right' });
                        totY += 16;

                        doc.font('Helvetica-Bold').fontSize(11);
                        doc.text('Total:', x, totY);
                        doc.text(formatCurrency(totTotal), x + 80, totY, { width: 70, align: 'right' });

                        blockHeight = totY - startY + 20;
                        break;
                    }

                    case 'payment_block': {
                        doc.fontSize(10).font('Helvetica-Bold');
                        doc.text('Payment', x, startY, { width });
                        let payY = startY + 16;

                        const paymentUrl = (itemConfig.content && typeof itemConfig.content === 'string')
                            ? resolveInvoiceTemplateString(itemConfig.content, {
                                ...rawData,
                                order: { ...order, ...rawData },
                                invoice: invoiceContext || {}
                            })
                            : (invoiceContext?.paymentUrl || '');
                        if (paymentUrl) {
                            doc.fontSize(9).font('Helvetica').fillColor(brandingSettings.primaryColor || '#4f46e5');
                            doc.text(`${paymentSettings?.payNowLabel || 'Pay now'}: ${paymentUrl}`, x, payY, { width });
                            doc.fillColor('black');
                            payY += 16;
                        }

                        if (invoiceContext?.paymentQrBuffer) {
                            try {
                                doc.image(invoiceContext.paymentQrBuffer, x, payY, { fit: [90, 90] });
                                payY += 96;
                            } catch (error) {
                                Logger.warn('Failed to render payment QR', { error });
                            }
                        }

                        blockHeight = Math.max(24, payY - startY);
                        break;
                    }

                    case 'text': {
                        let textContent = (itemConfig.content && typeof itemConfig.content === 'string') ? itemConfig.content : '';
                        const mergedContext = {
                            ...rawData,
                            order: { ...order, ...rawData },
                            invoice: invoiceContext || {}
                        };
                        textContent = resolveInvoiceTemplateString(textContent, mergedContext);

                        const style = (itemConfig.style && typeof itemConfig.style === 'object') ? itemConfig.style as InvoiceItemConfig['style'] : {};
                        doc.fontSize(parseInt(String(style?.fontSize ?? '10')) || 10);
                        if (style?.fontWeight === 'bold') doc.font('Helvetica-Bold');
                        else doc.font('Helvetica');

                        const textAlign = (style?.textAlign as 'left' | 'center' | 'right' | 'justify') || 'left';
                        doc.text(textContent, x, startY, { width, align: textAlign });
                        blockHeight = doc.heightOfString(textContent, { width }) + 10;
                        break;
                    }

                    case 'image': {
                        // Standalone image block
                        if (itemConfig.content && typeof itemConfig.content === 'string') {
                            try {
                                const imgUrl = itemConfig.content;
                                if (imgUrl.startsWith('/uploads/')) {
                                    const localPath = path.join(__dirname, '../../', imgUrl);
                                    if (fs.existsSync(localPath)) {
                                        doc.image(localPath, x, startY, { width, fit: [width, 150] });
                                        blockHeight = 150;
                                    } else {
                                        Logger.warn('Image file not found on disk', { imgUrl, localPath });
                                        blockHeight = 20;
                                    }
                                }
                            } catch (e) {
                                Logger.warn('Failed to render image in PDF', { error: e });
                                blockHeight = 20;
                            }
                        } else {
                            blockHeight = 20;
                        }
                        break;
                    }

                    case 'footer': {
                        doc.fontSize(9).font('Helvetica');
                        const footerContent = (itemConfig.content && typeof itemConfig.content === 'string') ? itemConfig.content : 'Thank you for your business!';
                        const footerParts = [footerContent];
                        if (complianceSettings?.legalFooter) {
                            footerParts.push(String(complianceSettings.legalFooter));
                        }
                        const footerText = footerParts.join('\n');
                        doc.text(footerText, x, startY, { width, align: 'center' });
                        blockHeight = doc.heightOfString(footerText, { width }) + 10;
                        break;
                    }

                    case 'row': {
                        // Row container - render children horizontally
                        const children = Array.isArray(itemConfig.children) ? itemConfig.children as string[] : [];
                        if (children.length > 0) {
                            const childWidth = width / children.length;
                            let maxChildHeight = 0;

                            children.forEach((childId, idx) => {
                                const childConfig = getItemConfig(childId);
                                if (childConfig) {
                                    const childHeight = renderBlock(childConfig, x + (idx * childWidth), childWidth - 10, startY);
                                    maxChildHeight = Math.max(maxChildHeight, childHeight);
                                }
                            });

                            blockHeight = maxChildHeight;
                        }
                        break;
                    }

                    default:
                        blockHeight = 20;
                }

                return blockHeight;
            };

            // Render each grid item using designer coordinates (x/y/w) to preserve layout.
            sortedGrid.forEach((gridItem: InvoiceGridItem) => {
                const itemConfig = getItemConfig(gridItem.i);
                if (!itemConfig) return;

                const rowIndex = Number(gridItem.y || 0);
                const pageIndex = Math.floor(rowIndex / rowsPerPage);
                const localRow = rowIndex % rowsPerPage;
                ensurePage(pageIndex);

                const itemX = marginLeft + ((gridItem.x || 0) * colWidth);
                const itemWidth = Math.max(colWidth, (gridItem.w || 1) * colWidth);
                const itemY = marginTop + (localRow * rowHeight);

                renderBlock(itemConfig, itemX, itemWidth, itemY);
            });

            // Register handlers before ending doc to avoid race condition
            stream.on('finish', resolve);
            stream.on('error', reject);

            doc.end();
        });
    }
}
