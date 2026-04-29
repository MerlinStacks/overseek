
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import {
    DEFAULT_INVOICE_TEMPLATE_SETTINGS,
    buildInvoiceNumber,
    formatInvoiceCurrency,
    formatInvoiceDate,
    mergeInvoiceSettings,
    resolveInvoiceTemplateString,
} from '../../../packages/overseek-core/dist/invoiceRenderModel';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// Ensure uploads directory exists
const INVOICE_DIR = path.join(__dirname, '../../uploads/invoices');
if (!fs.existsSync(INVOICE_DIR)) {
    fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

type InvoiceTemplateLayout = {
    grid: any[];
    items: any[];
    settings: any;
    versions: Array<{
        id: string;
        createdAt: string;
        name: string;
        layout: {
            grid: any[];
            items: any[];
            settings: any;
        };
    }>;
};


export class InvoiceService {
    private normalizeLayout(layout: any): InvoiceTemplateLayout {
        let parsed = layout;

        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch (error) {
                Logger.warn('[InvoiceService] Failed to parse template layout string', { error });
                parsed = {};
            }
        }

        const baseSettings = parsed?.settings && typeof parsed.settings === 'object'
            ? parsed.settings
            : {};

        const versions = Array.isArray(parsed?.versions) ? parsed.versions : [];

        return {
            grid: Array.isArray(parsed?.grid) ? parsed.grid : [],
            items: Array.isArray(parsed?.items) ? parsed.items : [],
            settings: mergeInvoiceSettings(baseSettings),
            versions: versions
                .filter((v: any) => v?.id && v?.layout)
                .slice(0, 25)
        };
    }

    private createVersionSnapshot(name: string, layout: InvoiceTemplateLayout) {
        return {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            name,
            layout: {
                grid: layout.grid,
                items: layout.items,
                settings: layout.settings
            }
        };
    }

    private nextVersionList(existingLayout: InvoiceTemplateLayout, currentName: string) {
        const snapshot = this.createVersionSnapshot(currentName, existingLayout);
        return [snapshot, ...existingLayout.versions].slice(0, 25);
    }

    /**
     * Creates or updates the single invoice template for an account.
     * Only one template is allowed per account - always overwrites existing.
     */
    async createTemplate(accountId: string, data: { name: string, layout: any }) {
        // Find existing template for this account
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { accountId }
        });

        const incomingLayout = this.normalizeLayout(data.layout);

        if (existing) {
            const existingLayout = this.normalizeLayout(existing.layout);
            // Update existing template
            return await prisma.invoiceTemplate.update({
                where: { id: existing.id },
                data: {
                    name: data.name,
                    layout: {
                        ...incomingLayout,
                        settings: {
                            ...existingLayout.settings,
                            ...incomingLayout.settings,
                            locale: {
                                ...existingLayout.settings.locale,
                                ...(incomingLayout.settings.locale || {})
                            },
                            numbering: {
                                ...existingLayout.settings.numbering,
                                ...(incomingLayout.settings.numbering || {})
                            },
                            compliance: {
                                ...existingLayout.settings.compliance,
                                ...(incomingLayout.settings.compliance || {})
                            },
                            payment: {
                                ...existingLayout.settings.payment,
                                ...(incomingLayout.settings.payment || {})
                            },
                            branding: {
                                ...existingLayout.settings.branding,
                                ...(incomingLayout.settings.branding || {})
                            }
                        },
                        versions: this.nextVersionList(existingLayout, existing.name)
                    }
                }
            });
        }

        // Create new template
        return await prisma.invoiceTemplate.create({
            data: {
                accountId,
                name: data.name,
                layout: incomingLayout
            }
        });
    }

    async updateTemplate(id: string, accountId: string, data: { name?: string, layout?: any }) {
        // Ensure belongs to account
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });

        if (!existing) throw new Error("Template not found or access denied");

        const existingLayout = this.normalizeLayout(existing.layout);
        const incomingLayout = data.layout
            ? this.normalizeLayout(data.layout)
            : existingLayout;

        const mergedLayout = {
            ...incomingLayout,
            settings: {
                ...existingLayout.settings,
                ...incomingLayout.settings,
                locale: {
                    ...existingLayout.settings.locale,
                    ...(incomingLayout.settings.locale || {})
                },
                numbering: {
                    ...existingLayout.settings.numbering,
                    ...(incomingLayout.settings.numbering || {})
                },
                compliance: {
                    ...existingLayout.settings.compliance,
                    ...(incomingLayout.settings.compliance || {})
                },
                payment: {
                    ...existingLayout.settings.payment,
                    ...(incomingLayout.settings.payment || {})
                },
                branding: {
                    ...existingLayout.settings.branding,
                    ...(incomingLayout.settings.branding || {})
                }
            },
            versions: this.nextVersionList(existingLayout, existing.name)
        };

        return await prisma.invoiceTemplate.update({
            where: { id },
            data: {
                name: data.name ?? existing.name,
                layout: mergedLayout
            }
        });
    }

    async getTemplate(id: string, accountId: string) {
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });
        if (!template) return template;
        return {
            ...template,
            layout: this.normalizeLayout(template.layout)
        };
    }

    async getTemplates(accountId: string) {
        const templates = await prisma.invoiceTemplate.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' }
        });
        return templates.map((template) => ({
            ...template,
            layout: this.normalizeLayout(template.layout)
        }));
    }

    async getTemplateVersions(id: string, accountId: string) {
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });
        if (!template) throw new Error("Template not found or access denied");
        const layout = this.normalizeLayout(template.layout);
        return layout.versions;
    }

    async rollbackTemplateVersion(id: string, accountId: string, versionId: string) {
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });
        if (!template) throw new Error("Template not found or access denied");

        const currentLayout = this.normalizeLayout(template.layout);
        const targetVersion = currentLayout.versions.find((version) => version.id === versionId);
        if (!targetVersion) throw new Error("Version not found");

        const rollbackLayout = this.normalizeLayout(targetVersion.layout);
        const versionsAfterRollback = this.nextVersionList(currentLayout, template.name)
            .filter((version) => version.id !== versionId);

        return await prisma.invoiceTemplate.update({
            where: { id: template.id },
            data: {
                layout: {
                    ...rollbackLayout,
                    versions: versionsAfterRollback
                }
            }
        });
    }

    async deleteTemplate(id: string, accountId: string) {
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });

        if (!existing) throw new Error("Template not found or access denied");

        return await prisma.invoiceTemplate.delete({
            where: { id }
        });
    }

    /**
     * Generates a PDF for an order based on a template.
     * Uses pdfkit to generate a professional PDF invoice.
     */
    async generateInvoicePdf(accountId: string, orderId: string, templateId: string): Promise<{ relativeUrl: string, absolutePath: string }> {
        // 1. Fetch Order Data with account scoping.
        // Allow either internal WooOrder.id (uuid) or WooCommerce wooId (numeric).
        const parsedWooId = Number(orderId);
        const order = await prisma.wooOrder.findFirst({
            where: {
                accountId,
                OR: [
                    { id: orderId },
                    ...(Number.isFinite(parsedWooId) ? [{ wooId: parsedWooId }] : [])
                ]
            }
        });

        if (!order) throw new Error("Order not found");

        // 2. Fetch Template
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id: templateId, accountId }
        });

        if (!template) throw new Error("Invoice Template not found");

        const normalizedLayout = this.normalizeLayout(template.layout);
        const settings = normalizedLayout.settings;

        Logger.info(`Generating PDF for Order`, { orderNumber: order.number, templateName: template.name });

        // 3. Parse raw order data for invoice details
        const rawData = order.rawData as any || {};
        const billing = rawData.billing || {};
        const lineItems = rawData.line_items || [];

        const mergedSettings = mergeInvoiceSettings(settings);
        const nextNumber = Math.max(1, Number(mergedSettings.numbering.nextNumber ?? 1001));
        const invoiceNumber = buildInvoiceNumber(mergedSettings);
        const issueDate = new Date();
        const termsDays = Number(mergedSettings.compliance.paymentTermsDays ?? 14);
        const dueDate = new Date(issueDate);
        dueDate.setDate(issueDate.getDate() + Math.max(0, termsDays));

        const mergedContext = {
            ...rawData,
            order: { ...order, ...rawData },
            invoice: {
                number: invoiceNumber,
                issueDate: formatInvoiceDate(issueDate, mergedSettings),
                dueDate: formatInvoiceDate(dueDate, mergedSettings),
                paymentTermsDays: Math.max(0, termsDays)
            }
        };

        const paymentUrlTemplate = mergedSettings.payment.payNowUrl || '';
        const paymentUrl = paymentUrlTemplate
            ? resolveInvoiceTemplateString(paymentUrlTemplate, mergedContext)
            : '';

        let paymentQrBuffer: Buffer | null = null;
        if (paymentUrl && settings?.payment?.includeQrCode !== false) {
            try {
                paymentQrBuffer = await QRCode.toBuffer(paymentUrl, { type: 'png', width: 220, margin: 0 });
            } catch (error) {
                Logger.warn('[InvoiceService] Failed to generate payment QR', { error });
            }
        }

        const invoiceContext = {
            number: invoiceNumber,
            issueDate: formatInvoiceDate(issueDate, mergedSettings),
            dueDate: formatInvoiceDate(dueDate, mergedSettings),
            paymentTermsDays: Math.max(0, termsDays),
            paymentUrl,
            paymentQrBuffer
        };

        await prisma.invoiceTemplate.update({
            where: { id: template.id },
            data: {
                layout: {
                    ...normalizedLayout,
                    settings: {
                        ...normalizedLayout.settings,
                        numbering: {
                            ...normalizedLayout.settings.numbering,
                            nextNumber: nextNumber + 1
                        }
                    }
                }
            }
        });

        // 4. Generate PDF invoice
        const fileName = `invoice-${order.number}-${Date.now()}.pdf`;
        const filePath = path.join(INVOICE_DIR, fileName);

        await this.createPdf(filePath, order, billing, lineItems, template, normalizedLayout, invoiceContext);

        Logger.info(`Invoice PDF saved`, { filePath });

        // Return relative URL and absolute path
        return {
            relativeUrl: `/uploads/invoices/${fileName}`,
            absolutePath: filePath
        };
    }

    /**
     * Create PDF file using PDFKit based on the saved template layout
     */
    private createPdf(
        filePath: string,
        order: any,
        billing: any,
        lineItems: any[],
        template: any,
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
            let layoutData: any = normalizedLayout || template.layout;
            Logger.info('Template layout raw type', { type: typeof layoutData, hasLayout: !!layoutData });

            if (typeof layoutData === 'string') {
                try {
                    layoutData = JSON.parse(layoutData);
                    Logger.info('Parsed layout from string');
                } catch (e) {
                    Logger.error('Failed to parse template layout', { error: e });
                }
            }

            const grid = layoutData?.grid || [];
            const items = layoutData?.items || [];
            const settings = mergeInvoiceSettings(layoutData?.settings || DEFAULT_INVOICE_TEMPLATE_SETTINGS);
            const localeSettings = settings.locale;
            const complianceSettings = settings.compliance;
            const paymentSettings = settings.payment;
            const brandingSettings = settings.branding;

            Logger.info('Template layout extracted', {
                gridCount: grid.length,
                itemsCount: items.length,
                itemTypes: items.map((i: any) => i.type)
            });

            // Helpers — use Intl.NumberFormat with order currency for consistency with HTML preview
            const orderCurrency = (order.rawData as any)?.currency || localeSettings.currency || 'AUD';
            const formatCurrency = (val: any) => {
                return formatInvoiceCurrency(parseFloat(val || 0), settings, orderCurrency);
            };
            const formatDate = (d: Date) => formatInvoiceDate(d, settings);

            /** Decode HTML entities (&#NNN; and common named entities) to actual characters. */
            const decodeEntities = (text: string): string => {
                return text
                    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
                    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'");
            };
            const rawData = order.rawData as any || {};

            // Page dimensions (A4 with 50pt margins)
            const pageWidth = 495; // 595 - 100 (margins)
            const colWidth = pageWidth / 12;
            const rowHeight = 30;
            const marginLeft = 50;
            const marginTop = 50;
            const pageHeight = 742;
            const rowsPerPage = Math.max(1, Math.floor(pageHeight / rowHeight));

            // Sort grid items by Y position
            const sortedGrid = [...grid].sort((a: any, b: any) => (a.y - b.y) || (a.x - b.x));

            // Find item config by ID
            const getItemConfig = (id: string) => items.find((i: any) => i.id === id);

            let currentPageIndex = 0;
            const ensurePage = (targetIndex: number) => {
                while (currentPageIndex < targetIndex) {
                    doc.addPage();
                    currentPageIndex += 1;
                }
            };

            // Render a single block
            const renderBlock = (itemConfig: any, x: number, width: number, startY: number): number => {
                if (!itemConfig) return 0;

                let blockHeight = 0;
                const type = itemConfig.type;

                switch (type) {
                    case 'header': {
                        // Header with logo and business details
                        doc.fontSize(10);
                        if (itemConfig.businessDetails) {
                            const lines = itemConfig.businessDetails.split('\n');
                            lines.forEach((line: string, i: number) => {
                                doc.text(line, x + width - 200, startY + (i * 12), { width: 200, align: 'right' });
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
                        const rawData = order.rawData as any || {};
                        const shippingMethod = rawData.shipping_lines?.[0]?.method_title || 'N/A';
                        const paymentMethod = rawData.payment_method_title || order.paymentMethod || 'N/A';
                        // Use WooCommerce's date_created for consistency with client-side rendering
                        const orderDate = rawData.date_created
                            ? formatDate(new Date(rawData.date_created))
                            : formatDate(order.createdAt);

                        const detailsData = [
                            ['Invoice Number:', invoiceContext?.number || 'N/A'],
                            ['Invoice Date:', invoiceContext?.issueDate || orderDate],
                            ['Due Date:', invoiceContext?.dueDate || orderDate],
                            ['Order Number:', order.number],
                            ['Order Date:', orderDate],
                            ['Payment Method:', paymentMethod],
                            ['Shipping Method:', shippingMethod]
                        ];

                        let detY = startY;
                        detailsData.forEach(([label, value]) => {
                            doc.font('Helvetica').fillColor('#64748b').text(label, x, detY, { continued: false });
                            doc.font('Helvetica-Bold').fillColor('black').text(value, x + 100, detY);
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

                        // Keys to exclude from metadata display (internal plugin/system keys)
                        const excludedKeyPatterns = [
                            /^_/, /^pa_/, /wcpa/i, /meta_data/i,
                            /^reduced_stock/i, /label_map/i, /droppable/i, /^id$/i, /^key$/i
                        ];
                        const isExcludedKey = (key: string) => excludedKeyPatterns.some(p => p.test(key));

                        lineItems.forEach((item: any) => {
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
                            const unitPrice = qty > 0 ? (parseFloat(item.total || 0) / qty) : 0;

                            doc.text(itemName, tableX, tableY, { width: descWidth - 10 });
                            doc.text(String(qty), tableX + descWidth, tableY, { width: qtyWidth, align: 'center' });
                            doc.text(formatCurrency(unitPrice), tableX + descWidth + qtyWidth, tableY, { width: priceWidth, align: 'right' });
                            doc.text(formatCurrency(item.total), tableX + descWidth + qtyWidth + priceWidth, tableY, { width: totalWidth, align: 'right' });

                            // Display user-facing metadata with proper filtering
                            const itemMeta = (item.meta_data || []).filter((m: any) => {
                                const key = m.key || '';
                                if (isExcludedKey(key)) return false;
                                if (!m.display_key && !m.display_value) return false;
                                return true;
                            });
                            if (itemMeta.length > 0) {
                                tableY += 12;
                                doc.fontSize(8).fillColor('#64748b');
                                itemMeta.slice(0, 6).forEach((m: any) => {
                                    const label = m.display_key || m.key.replace(/_/g, ' ');
                                    const val = typeof m.value === 'object' ? JSON.stringify(m.value) : (m.display_value || m.value);
                                    doc.text(decodeEntities(`${label}: ${val}`), tableX + 10, tableY, { width: descWidth - 20 });
                                    tableY += 10;
                                });
                                doc.fillColor('black').fontSize(9);
                            }

                            tableY += 14;
                        });

                        // Totals integrated into table — use rawData for consistency
                        const rawOrderData = order.rawData as any || {};
                        doc.moveTo(tableX, tableY).lineTo(tableX + fullTableWidth, tableY).stroke();
                        tableY += 10;

                        const taxVal = parseFloat(rawOrderData.total_tax ?? order.taxTotal ?? 0);
                        const shipVal = parseFloat(rawOrderData.shipping_total ?? order.shippingTotal ?? 0);
                        const totalVal = parseFloat(rawOrderData.total ?? order.total ?? 0);
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

                        const discountVal = parseFloat(rawOrderData.discount_total ?? 0);
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
                        const rawTotals = order.rawData as any || {};
                        const totTax = parseFloat(rawTotals.total_tax ?? order.taxTotal ?? 0);
                        const totShip = parseFloat(rawTotals.shipping_total ?? order.shippingTotal ?? 0);
                        const totTotal = parseFloat(rawTotals.total ?? order.total ?? 0);
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

                        const totDiscount = parseFloat(rawTotals.discount_total ?? 0);
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

                        const paymentUrl = itemConfig.content
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
                        let textContent = itemConfig.content || '';
                        const mergedContext = {
                            ...rawData,
                            order: { ...order, ...rawData },
                            invoice: invoiceContext || {}
                        };
                        textContent = resolveInvoiceTemplateString(textContent, mergedContext);

                        const style = itemConfig.style || {};
                        doc.fontSize(parseInt(style.fontSize) || 10);
                        if (style.fontWeight === 'bold') doc.font('Helvetica-Bold');
                        else doc.font('Helvetica');

                        doc.text(textContent, x, startY, { width, align: style.textAlign || 'left' });
                        blockHeight = doc.heightOfString(textContent, { width }) + 10;
                        break;
                    }

                    case 'image': {
                        // Standalone image block
                        if (itemConfig.content) {
                            try {
                                const imgUrl: string = itemConfig.content;
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
                        const footerParts = [itemConfig.content || 'Thank you for your business!'];
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
                        const children = itemConfig.children || [];
                        if (children.length > 0) {
                            const childWidth = width / children.length;
                            let maxChildHeight = 0;

                            children.forEach((childId: string, idx: number) => {
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
            sortedGrid.forEach((gridItem: any) => {
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

