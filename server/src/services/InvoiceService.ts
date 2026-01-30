
import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

// Ensure uploads directory exists
const INVOICE_DIR = path.join(__dirname, '../../uploads/invoices');
if (!fs.existsSync(INVOICE_DIR)) {
    fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

export class InvoiceService {

    /**
     * Creates or updates the single invoice template for an account.
     * Only one template is allowed per account - always overwrites existing.
     */
    async createTemplate(accountId: string, data: { name: string, layout: any }) {
        // Find existing template for this account
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { accountId }
        });

        if (existing) {
            // Update existing template
            return await prisma.invoiceTemplate.update({
                where: { id: existing.id },
                data: {
                    name: data.name,
                    layout: data.layout
                }
            });
        }

        // Create new template
        return await prisma.invoiceTemplate.create({
            data: {
                accountId,
                name: data.name,
                layout: data.layout
            }
        });
    }

    async updateTemplate(id: string, accountId: string, data: { name?: string, layout?: any }) {
        // Ensure belongs to account
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });

        if (!existing) throw new Error("Template not found or access denied");

        return await prisma.invoiceTemplate.update({
            where: { id },
            data: {
                ...data
            }
        });
    }

    async getTemplate(id: string, accountId: string) {
        return await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });
    }

    async getTemplates(accountId: string) {
        return await prisma.invoiceTemplate.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' }
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
        // 1. Fetch Order Data with raw JSON
        const order = await prisma.wooOrder.findUnique({
            where: { id: orderId }
        });

        if (!order) throw new Error("Order not found");

        // 2. Fetch Template
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id: templateId, accountId }
        });

        if (!template) throw new Error("Invoice Template not found");

        Logger.info(`Generating PDF for Order`, { orderNumber: order.number, templateName: template.name });

        // 3. Parse raw order data for invoice details
        const rawData = order.rawData as any || {};
        const billing = rawData.billing || {};
        const lineItems = rawData.line_items || [];

        // 4. Generate PDF invoice
        const fileName = `invoice-${order.number}-${Date.now()}.pdf`;
        const filePath = path.join(INVOICE_DIR, fileName);

        await this.createPdf(filePath, order, billing, lineItems, template);

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
    private createPdf(filePath: string, order: any, billing: any, lineItems: any[], template: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const PDFDocument = require('pdfkit');
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const stream = fs.createWriteStream(filePath);

            doc.pipe(stream);

            // Parse template layout
            let layoutData = template.layout;
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

            Logger.info('Template layout extracted', {
                gridCount: grid.length,
                itemsCount: items.length,
                itemTypes: items.map((i: any) => i.type)
            });

            // Helpers
            const formatCurrency = (val: any) => `$${parseFloat(val || 0).toFixed(2)}`;
            const formatDate = (d: Date) => d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });

            // Page dimensions (A4 with 50pt margins)
            const pageWidth = 495; // 595 - 100 (margins)
            const colWidth = pageWidth / 12;
            const rowHeight = 30;
            const marginLeft = 50;
            const marginTop = 50;

            // Sort grid items by Y position
            const sortedGrid = [...grid].sort((a: any, b: any) => a.y - b.y);

            let currentY = marginTop;

            // Find item config by ID
            const getItemConfig = (id: string) => items.find((i: any) => i.id === id);

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
                        if (itemConfig.logo) {
                            try {
                                // Logo handling would require fetching the image
                                // For now, skip logo in PDF
                            } catch (e) {
                                // Ignore logo errors
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

                        const detailsData = [
                            ['Order Number:', order.number],
                            ['Order Date:', formatDate(order.createdAt)],
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
                        // Table header
                        doc.fontSize(9).font('Helvetica-Bold');
                        const tableX = x;
                        const descWidth = width * 0.5;
                        const qtyWidth = 40;
                        const priceWidth = 60;
                        const totalWidth = 60;

                        doc.text('Description', tableX, startY);
                        doc.text('Qty', tableX + descWidth, startY, { width: qtyWidth, align: 'center' });
                        doc.text('Price', tableX + descWidth + qtyWidth, startY, { width: priceWidth, align: 'right' });
                        doc.text('Total', tableX + descWidth + qtyWidth + priceWidth, startY, { width: totalWidth, align: 'right' });

                        doc.moveTo(tableX, startY + 12).lineTo(tableX + width, startY + 12).stroke();

                        let tableY = startY + 18;
                        doc.font('Helvetica').fontSize(9);

                        lineItems.forEach((item: any) => {
                            // Check for page break
                            if (tableY > 720) {
                                doc.addPage();
                                tableY = 50;
                            }

                            const itemName = item.name || 'Product';
                            const qty = item.quantity || 1;
                            const unitPrice = qty > 0 ? (parseFloat(item.total || 0) / qty) : 0;

                            doc.text(itemName, tableX, tableY, { width: descWidth - 10 });
                            doc.text(String(qty), tableX + descWidth, tableY, { width: qtyWidth, align: 'center' });
                            doc.text(formatCurrency(unitPrice), tableX + descWidth + qtyWidth, tableY, { width: priceWidth, align: 'right' });
                            doc.text(formatCurrency(item.total), tableX + descWidth + qtyWidth + priceWidth, tableY, { width: totalWidth, align: 'right' });

                            // Check for metadata
                            const itemMeta = item.meta_data?.filter((m: any) => !m.key.startsWith('_')) || [];
                            if (itemMeta.length > 0) {
                                tableY += 12;
                                doc.fontSize(8).fillColor('#64748b');
                                itemMeta.slice(0, 3).forEach((m: any) => {
                                    const label = m.display_key || m.key.replace(/_/g, ' ');
                                    const val = typeof m.value === 'object' ? JSON.stringify(m.value) : (m.display_value || m.value);
                                    doc.text(`${label}: ${val}`, tableX + 10, tableY, { width: descWidth - 20 });
                                    tableY += 10;
                                });
                                doc.fillColor('black').fontSize(9);
                            }

                            tableY += 14;
                        });

                        // Totals integrated into table
                        doc.moveTo(tableX, tableY).lineTo(tableX + width, tableY).stroke();
                        tableY += 10;

                        const subtotal = parseFloat(order.total) - parseFloat(order.taxTotal || 0) - parseFloat(order.shippingTotal || 0);
                        const totalsX = tableX + width - 150;

                        doc.font('Helvetica').fontSize(9);
                        doc.text('Subtotal', totalsX, tableY);
                        doc.text(formatCurrency(subtotal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 14;

                        if (order.shippingTotal && parseFloat(order.shippingTotal) > 0) {
                            doc.text('Shipping', totalsX, tableY);
                            doc.text(formatCurrency(order.shippingTotal), totalsX + 80, tableY, { width: 70, align: 'right' });
                            tableY += 14;
                        }

                        doc.text('Tax', totalsX, tableY);
                        doc.text(formatCurrency(order.taxTotal), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 16;

                        doc.font('Helvetica-Bold').fontSize(11);
                        doc.text('Total', totalsX, tableY);
                        doc.text(formatCurrency(order.total), totalsX + 80, tableY, { width: 70, align: 'right' });
                        tableY += 20;

                        blockHeight = tableY - startY;
                        break;
                    }

                    case 'totals': {
                        // Standalone totals block (if not integrated into order_table)
                        const subtotalVal = parseFloat(order.total) - parseFloat(order.taxTotal || 0) - parseFloat(order.shippingTotal || 0);
                        doc.fontSize(9).font('Helvetica');

                        let totY = startY;
                        doc.text('Subtotal:', x, totY);
                        doc.text(formatCurrency(subtotalVal), x + 80, totY, { width: 70, align: 'right' });
                        totY += 14;

                        if (order.shippingTotal && parseFloat(order.shippingTotal) > 0) {
                            doc.text('Shipping:', x, totY);
                            doc.text(formatCurrency(order.shippingTotal), x + 80, totY, { width: 70, align: 'right' });
                            totY += 14;
                        }

                        doc.text('Tax:', x, totY);
                        doc.text(formatCurrency(order.taxTotal), x + 80, totY, { width: 70, align: 'right' });
                        totY += 16;

                        doc.font('Helvetica-Bold').fontSize(11);
                        doc.text('Total:', x, totY);
                        doc.text(formatCurrency(order.total), x + 80, totY, { width: 70, align: 'right' });

                        blockHeight = totY - startY + 20;
                        break;
                    }

                    case 'text': {
                        let textContent = itemConfig.content || '';
                        // Simple handlebars replacement
                        textContent = textContent.replace(/\{\{order\.number\}\}/g, order.number || '');
                        textContent = textContent.replace(/\{\{order\.total\}\}/g, formatCurrency(order.total));

                        const style = itemConfig.style || {};
                        doc.fontSize(parseInt(style.fontSize) || 10);
                        if (style.fontWeight === 'bold') doc.font('Helvetica-Bold');
                        else doc.font('Helvetica');

                        doc.text(textContent, x, startY, { width, align: style.textAlign || 'left' });
                        blockHeight = doc.heightOfString(textContent, { width }) + 10;
                        break;
                    }

                    case 'footer': {
                        doc.fontSize(9).font('Helvetica');
                        const footerText = itemConfig.content || 'Thank you for your business!';
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

            // Render each grid item in order
            sortedGrid.forEach((gridItem: any) => {
                const itemConfig = getItemConfig(gridItem.i);
                if (!itemConfig) return;

                const x = marginLeft + (gridItem.x * colWidth);
                const width = gridItem.w * colWidth;

                // Check for page break
                if (currentY > 720 && itemConfig.type !== 'footer') {
                    doc.addPage();
                    currentY = marginTop;
                }

                const blockHeight = renderBlock(itemConfig, x, width, currentY);
                currentY += blockHeight + 10; // Add spacing between blocks
            });

            doc.end();

            stream.on('finish', resolve);
            stream.on('error', reject);
        });
    }
}

