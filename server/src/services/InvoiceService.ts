
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { randomUUID } from 'crypto';
import {
    DEFAULT_INVOICE_TEMPLATE_SETTINGS,
    buildInvoiceNumber,
    decodeInvoiceEntities,
    formatInvoiceCurrency,
    formatInvoiceDate,
    getInvoiceItemMeta,
    mergeInvoiceSettings,
    resolveInvoiceTemplateString,
} from '@overseek/core';
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
                // Guard: pathologically large template strings can OOM during parse
                if (parsed.length > 10 * 1024 * 1024) {
                    Logger.warn('[InvoiceService] Template layout string exceeds safe size, skipping parse', {
                        sizeMB: (parsed.length / 1024 / 1024).toFixed(2)
                    });
                    parsed = {};
                } else {
                    parsed = JSON.parse(parsed);
                }
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
                    // Guard: pathologically large template strings can OOM during parse
                    if (layoutData.length > 10 * 1024 * 1024) {
                        Logger.warn('[InvoiceService] Layout data string exceeds safe size, skipping parse', {
                            sizeMB: (layoutData.length / 1024 / 1024).toFixed(2)
                        });
                    } else {
                        layoutData = JSON.parse(layoutData);
                        Logger.info('Parsed layout from string');
                    }
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

            const rawData = order.rawData as any || {};

            // Page + grid metrics (aligned with designer canvas/react-grid-layout spacing)
            const pageWidth = 495; // 595 - 100 (A4 width minus 50pt margins)
            const marginLeft = 50;
            const marginTop = 50;
            const pageHeight = 742;
            const DESIGN_WIDTH_PX = 794;
            const GRID_COLS = 12;
            const GRID_ROW_HEIGHT_PX = 30;
            const GRID_MARGIN_X_PX = 16;
            const GRID_MARGIN_Y_PX = 8;

            const pxToPt = pageWidth / DESIGN_WIDTH_PX;
            const colWidthPx = (DESIGN_WIDTH_PX - ((GRID_COLS - 1) * GRID_MARGIN_X_PX)) / GRID_COLS;
            const rowSpanPx = GRID_ROW_HEIGHT_PX + GRID_MARGIN_Y_PX;
            const usablePageHeight = pageHeight;

            const normalizeGridItem = (entry: any, itemType?: string) => {
                let x = Math.max(0, Math.min(GRID_COLS - 1, Number(entry?.x || 0)));
                let w = Math.max(1, Math.min(GRID_COLS, Number(entry?.w || 1)));
                if (x + w > GRID_COLS) w = GRID_COLS - x;

                // Match the client vector renderer behavior: nearly full-width tables snap to full width.
                if (itemType === 'order_table' && w >= 11) {
                    x = 0;
                    w = GRID_COLS;
                }

                return {
                    ...entry,
                    x,
                    y: Math.max(0, Number(entry?.y || 0)),
                    w,
                    h: Math.max(1, Number(entry?.h || 1)),
                };
            };

            const toItemBounds = (entry: any) => {
                const xPx = entry.x * (colWidthPx + GRID_MARGIN_X_PX);
                const yPx = entry.y * rowSpanPx;
                const wPx = (entry.w * colWidthPx) + (Math.max(0, entry.w - 1) * GRID_MARGIN_X_PX);
                const hPx = (entry.h * GRID_ROW_HEIGHT_PX) + (Math.max(0, entry.h - 1) * GRID_MARGIN_Y_PX);
                return {
                    x: marginLeft + (xPx * pxToPt),
                    y: marginTop + (yPx * pxToPt),
                    w: Math.max(20, wPx * pxToPt),
                    h: Math.max(18, hPx * pxToPt),
                };
            };

            // Sort grid items by Y position
            const sortedGrid = [...grid].sort((a: any, b: any) => (a.y - b.y) || (a.x - b.x));

            // Find item config by ID
            const getItemConfig = (id: string) => items.find((i: any) => i.id === id);

            const footerStartByPage = new Map<number, number>();
            sortedGrid.forEach((gridItem: any) => {
                const itemConfig = getItemConfig(gridItem.i);
                if (!itemConfig || itemConfig.type !== 'footer') return;
                const normalizedGridItem = normalizeGridItem(gridItem, itemConfig.type);
                const bounds = toItemBounds(normalizedGridItem);
                const normalizedY = Math.max(0, bounds.y - marginTop);
                const pageIndex = Math.floor(normalizedY / usablePageHeight);
                const footerY = marginTop + (normalizedY - (pageIndex * usablePageHeight));
                const current = footerStartByPage.get(pageIndex);
                if (current === undefined || footerY < current) {
                    footerStartByPage.set(pageIndex, footerY);
                }
            });

            const defaultBottomReserve = 120;
            const getPageContentLimitY = (pageIndex: number) => {
                const footerStart = footerStartByPage.get(pageIndex);
                if (typeof footerStart === 'number') return Math.max(marginTop + 40, footerStart - 10);
                return marginTop + pageHeight - defaultBottomReserve;
            };

            let currentPageIndex = 0;
            const ensurePage = (targetIndex: number) => {
                while (currentPageIndex < targetIndex) {
                    doc.addPage();
                    currentPageIndex += 1;
                }
            };

            // Render a single block
            const renderBlock = (itemConfig: any, x: number, width: number, startY: number, height = 60): number => {
                if (!itemConfig) return 0;

                let blockHeight = 0;
                const type = itemConfig.type;

                switch (type) {
                    case 'header': {
                        // Header with logo and business details
                        const logoWidth = Math.min(120, Math.max(80, width * 0.35));
                        const detailsWidth = Math.max(90, Math.min(220, width - logoWidth - 10));
                        const detailsX = x + width - detailsWidth;
                        const availableHeight = Math.max(30, height - 4);

                        const businessText = String(itemConfig.businessDetails || '').trim();
                        const hasTaxId = Boolean(complianceSettings?.taxIdValue);
                        const taxLabel = complianceSettings?.taxIdLabel || 'Tax ID';
                        const taxText = `${taxLabel}: ${complianceSettings?.taxIdValue || ''}`;

                        let businessFontSize = 10;
                        let taxFontSize = 9;

                        for (let font = 11; font >= 8; font -= 1) {
                            const nextTaxFont = Math.max(8, font - 1);
                            let requiredHeight = 0;

                            if (businessText) {
                                doc.font('Helvetica').fontSize(font);
                                requiredHeight += doc.heightOfString(businessText, { width: detailsWidth, align: 'right' });
                            }

                            if (hasTaxId) {
                                if (requiredHeight > 0) requiredHeight += 4;
                                doc.font('Helvetica-Bold').fontSize(nextTaxFont);
                                requiredHeight += doc.heightOfString(taxText, { width: detailsWidth, align: 'right' });
                            }

                            if (requiredHeight <= availableHeight) {
                                businessFontSize = font;
                                taxFontSize = nextTaxFont;
                                break;
                            }
                        }

                        let detailsY = startY;
                        if (businessText) {
                            doc.font('Helvetica').fontSize(businessFontSize);
                            doc.text(businessText, detailsX, detailsY, { width: detailsWidth, align: 'right' });
                            detailsY += doc.heightOfString(businessText, { width: detailsWidth, align: 'right' });
                        }

                        if (hasTaxId) {
                            if (detailsY > startY) detailsY += 4;
                            doc.font('Helvetica-Bold').fontSize(taxFontSize);
                            doc.text(taxText, detailsX, detailsY, { width: detailsWidth, align: 'right' });
                            detailsY += doc.heightOfString(taxText, { width: detailsWidth, align: 'right' });
                        }

                        blockHeight = Math.max(blockHeight, detailsY - startY);

                        if (itemConfig.logo) {
                            try {
                                // Resolve relative URL to local file path
                                const logoUrl: string = itemConfig.logo;
                                if (logoUrl.startsWith('/uploads/')) {
                                    const localPath = path.join(__dirname, '../../', logoUrl.replace(/^\//, ''));
                                    if (fs.existsSync(localPath)) {
                                        const logoHeight = Math.max(40, Math.min(60, availableHeight));
                                        doc.image(localPath, x, startY, { width: logoWidth, height: logoHeight, fit: [logoWidth, logoHeight] });
                                    } else {
                                        Logger.warn('Logo file not found on disk', { logoUrl, localPath });
                                    }
                                }
                            } catch (e) {
                                Logger.warn('Failed to render logo in PDF', { error: e });
                            }
                        }
                        blockHeight = Math.max(blockHeight, Math.min(60, availableHeight));
                        doc.font('Helvetica').fontSize(10);
                        break;
                    }

                    case 'customer_details': {
                        doc.font('Helvetica-Bold').fontSize(8).fillColor('#94a3b8');
                        doc.text('BILL TO', x, startY);
                        doc.font('Helvetica').fontSize(9).fillColor('#334155');
                        let custY = startY + 14;
                        if (billing.first_name || billing.last_name) {
                            doc.font('Helvetica-Bold').fillColor('#1f2937').text(`${billing.first_name || ''} ${billing.last_name || ''}`, x, custY);
                            doc.font('Helvetica').fillColor('#334155');
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
                            doc.fillColor('#2563eb').text(billing.email, x, custY);
                            doc.fillColor('#334155');
                            custY += 12;
                        }
                        if (billing.phone) {
                            doc.text(billing.phone, x, custY);
                            custY += 12;
                        }
                        doc.fillColor('black').font('Helvetica').fontSize(10);
                        blockHeight = custY - startY + 8;
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
                        const detailLabelWidth = Math.min(120, Math.max(88, width * 0.45));
                        detailsData.forEach(([label, value]) => {
                            doc.font('Helvetica').fillColor('#64748b').text(label, x, detY, { width: detailLabelWidth });
                            doc.font('Helvetica-Bold').fillColor('#1f2937').text(value, x + detailLabelWidth + 6, detY, {
                                width: Math.max(40, width - detailLabelWidth - 6)
                            });
                            detY += 13;
                        });
                        doc.fillColor('black').font('Helvetica').fontSize(10);
                        blockHeight = detY - startY + 10;
                        break;
                    }

                    case 'order_table': {
                        // Respect saved grid width/position so generated output follows designer layout.
                        doc.fontSize(9).font('Helvetica-Bold');
                        const tableFooterSafetyBuffer = 18;
                        const tableX = x;
                        const fullTableWidth = width;
                        const descWidth = fullTableWidth * 0.55;
                        const qtyWidth = 40;
                        const priceWidth = 70;
                        const totalWidth = fullTableWidth - descWidth - qtyWidth - priceWidth;

                        doc.fillColor('#334155').text('Description', tableX, startY);
                        doc.text('Qty', tableX + descWidth, startY, { width: qtyWidth, align: 'center' });
                        doc.text('Unit Price', tableX + descWidth + qtyWidth, startY, { width: priceWidth, align: 'right' });
                        doc.text('Total', tableX + descWidth + qtyWidth + priceWidth, startY, { width: totalWidth, align: 'right' });

                        doc.moveTo(tableX, startY + 12).lineTo(tableX + fullTableWidth, startY + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
                        doc.strokeColor('black').lineWidth(1);

                        let tableY = startY + 18;
                        doc.font('Helvetica').fontSize(9);

                        const renderTableHeader = () => {
                            doc.fontSize(9).font('Helvetica-Bold');
                            doc.fillColor('#334155').text('Description', tableX, tableY);
                            doc.text('Qty', tableX + descWidth, tableY, { width: qtyWidth, align: 'center' });
                            doc.text('Unit Price', tableX + descWidth + qtyWidth, tableY, { width: priceWidth, align: 'right' });
                            doc.text('Total', tableX + descWidth + qtyWidth + priceWidth, tableY, { width: totalWidth, align: 'right' });
                            doc.moveTo(tableX, tableY + 12).lineTo(tableX + fullTableWidth, tableY + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
                            doc.strokeColor('black').lineWidth(1);
                            tableY += 18;
                            doc.font('Helvetica').fontSize(9).fillColor('black');
                        };

                        const moveTableToNextPage = () => {
                            doc.addPage();
                            currentPageIndex += 1;
                            tableY = marginTop;
                            renderTableHeader();
                        };

                        const getSafeContentLimitY = () => getPageContentLimitY(currentPageIndex) - tableFooterSafetyBuffer;

                        const ensureSpaceForHeight = (requiredHeight: number) => {
                            let contentLimitY = getSafeContentLimitY();
                            if ((tableY + requiredHeight) > contentLimitY) {
                                moveTableToNextPage();
                                contentLimitY = getSafeContentLimitY();
                            }
                            return contentLimitY;
                        };

                        lineItems.forEach((item: any) => {
                            const itemName = item.name || 'Product';
                            const qty = item.quantity || 1;
                            const unitPrice = qty > 0 ? (parseFloat(item.total || 0) / qty) : 0;
                            const itemMeta = getInvoiceItemMeta(item)
                                .filter((meta) => {
                                    const value = String(meta?.value || '').trim();
                                    return value.length > 0;
                                })
                                .slice(0, 6);
                            const truncateMetaValue = (value: string) => {
                                const compact = value.replace(/\s+/g, ' ').trim();
                                if (compact.length <= 120) return compact;
                                return `${compact.slice(0, 117)}...`;
                            };

                            const titleHeight = Math.max(12, doc.heightOfString(itemName, { width: descWidth - 10 }));
                            const metaLineHeights = itemMeta.map((meta) => {
                                const metaText = decodeInvoiceEntities(`${meta.label}: ${truncateMetaValue(String(meta.value || ''))}`);
                                return Math.max(
                                    10,
                                    doc.heightOfString(metaText, {
                                        width: descWidth - 20,
                                        lineGap: 0
                                    })
                                );
                            });
                            const metaHeight = metaLineHeights.reduce((acc, h) => acc + h, 0);
                            const metaSpacingHeight = itemMeta.length > 0 ? 2 : 0;
                            const rowBottomSpacing = 8;
                            const requiredRowHeight = titleHeight + metaSpacingHeight + metaHeight + rowBottomSpacing;
                            ensureSpaceForHeight(requiredRowHeight);

                            doc.text(itemName, tableX, tableY, { width: descWidth - 10 });
                            doc.text(String(qty), tableX + descWidth, tableY, { width: qtyWidth, align: 'center' });
                            doc.text(formatCurrency(unitPrice), tableX + descWidth + qtyWidth, tableY, { width: priceWidth, align: 'right' });
                            doc.text(formatCurrency(item.total), tableX + descWidth + qtyWidth + priceWidth, tableY, { width: totalWidth, align: 'right' });

                            const consumedTitleHeight = Math.max(12, titleHeight);
                            tableY += consumedTitleHeight;

                            if (itemMeta.length > 0) {
                                tableY += 2;
                                doc.fontSize(8).fillColor('#64748b');
                                itemMeta.forEach((meta, metaIdx) => {
                                    const metaText = decodeInvoiceEntities(`${meta.label}: ${truncateMetaValue(String(meta.value || ''))}`);
                                    const metaLineHeight = metaLineHeights[metaIdx] || 10;
                                    ensureSpaceForHeight(metaLineHeight + rowBottomSpacing);
                                    doc.text(
                                        metaText,
                                        tableX + 10,
                                        tableY,
                                        { width: descWidth - 20 }
                                    );
                                    tableY += metaLineHeight;
                                });
                                doc.fillColor('black').fontSize(9);
                            }

                            tableY += 8;
                            doc.moveTo(tableX, tableY - 3).lineTo(tableX + fullTableWidth, tableY - 3).strokeColor('#f1f5f9').lineWidth(0.7).stroke();
                            doc.strokeColor('black').lineWidth(1);
                        });

                        // Totals integrated into table — use rawData for consistency
                        const rawOrderData = order.rawData as any || {};
                        const estimatedTotalsHeight = 90;
                        ensureSpaceForHeight(estimatedTotalsHeight);
                        doc.moveTo(tableX, tableY).lineTo(tableX + fullTableWidth, tableY).strokeColor('#cbd5e1').lineWidth(1).stroke();
                        doc.strokeColor('black').lineWidth(1);
                        tableY += 10;

                        const taxVal = parseFloat(rawOrderData.total_tax ?? order.taxTotal ?? 0);
                        const shipVal = parseFloat(rawOrderData.shipping_total ?? order.shippingTotal ?? 0);
                        const totalVal = parseFloat(rawOrderData.total ?? order.total ?? 0);
                        const subtotal = totalVal - taxVal - shipVal;
                        const totalsX = tableX + fullTableWidth - 170;

                        doc.font('Helvetica').fontSize(9).fillColor('#475569');
                        doc.text('Subtotal', totalsX, tableY);
                        doc.fillColor('#334155').text(formatCurrency(subtotal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 14;

                        if (shipVal > 0) {
                            doc.fillColor('#475569').text('Shipping', totalsX, tableY);
                            doc.fillColor('#334155').text(formatCurrency(shipVal), totalsX + 80, tableY, { width: 70, align: 'right' });
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

                        doc.fillColor('#475569').text('Tax', totalsX, tableY);
                        doc.fillColor('#334155').text(formatCurrency(taxVal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 16;

                        doc.moveTo(totalsX, tableY - 3).lineTo(totalsX + 150, tableY - 3).strokeColor('#cbd5e1').lineWidth(1).stroke();
                        doc.strokeColor('black').lineWidth(1);

                        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a');
                        doc.text('Total', totalsX, tableY);
                        doc.text(formatCurrency(totalVal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        doc.fillColor('black');
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
                                    const localPath = path.join(__dirname, '../../', imgUrl.replace(/^\//, ''));
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
                                    const childHeight = renderBlock(childConfig, x + (idx * childWidth), childWidth - 10, startY, height);
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

                const normalizedGridItem = normalizeGridItem(gridItem, itemConfig.type);
                const bounds = toItemBounds(normalizedGridItem);
                const normalizedY = Math.max(0, bounds.y - marginTop);
                const pageIndex = Math.floor(normalizedY / usablePageHeight);
                const localY = normalizedY - (pageIndex * usablePageHeight);
                ensurePage(pageIndex);

                const itemX = bounds.x;
                const itemWidth = bounds.w;
                const itemY = marginTop + localY;
                const itemHeight = bounds.h;
                renderBlock(itemConfig, itemX, itemWidth, itemY, itemHeight);
            });

            // Register handlers before ending doc to avoid race condition
            stream.on('finish', resolve);
            stream.on('error', reject);

            doc.end();
        });
    }
}
