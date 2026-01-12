
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
     * Create PDF file using PDFKit
     */
    private createPdf(filePath: string, order: any, billing: any, lineItems: any[], template: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const PDFDocument = require('pdfkit');
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const stream = fs.createWriteStream(filePath);

            doc.pipe(stream);

            // Helpers
            const formatCurrency = (val: any) => `$${parseFloat(val || 0).toFixed(2)}`;
            const formatDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            // --- Header ---
            doc.fontSize(20).text('INVOICE', { align: 'right' });
            doc.fontSize(10).text(`#${order.number}`, { align: 'right' });
            doc.text(`Date: ${formatDate(order.createdAt)}`, { align: 'right' });
            doc.moveDown();

            // Company Name
            doc.fontSize(16).text(template.name || 'Your Company', 50, 50);
            doc.moveDown();

            // --- Bill To ---
            const startY = 150;
            doc.fontSize(12).text('Bill To:', 50, startY);
            doc.fontSize(10)
                .text(`${billing.first_name || ''} ${billing.last_name || ''}`, 50, startY + 20)
                .text(billing.address_1 || '', 50, startY + 35)
                .text(billing.address_2 || '', 50, startY + 50)
                .text(`${billing.city || ''}, ${billing.state || ''} ${billing.postcode || ''}`, 50, startY + 65)
                .text(billing.country || '', 50, startY + 80)
                .text(billing.email || '', 50, startY + 95);

            // --- Items Table Header ---
            const tableTop = 300;
            const itemX = 50;
            const qtyX = 300;
            const priceX = 370;
            const totalX = 450;

            doc.fontSize(10).font('Helvetica-Bold');
            doc.text('Item', itemX, tableTop);
            doc.text('Qty', qtyX, tableTop);
            doc.text('Price', priceX, tableTop, { width: 70, align: 'right' });
            doc.text('Total', totalX, tableTop, { width: 70, align: 'right' });

            doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

            // --- Items ---
            let y = tableTop + 25;
            doc.font('Helvetica');

            lineItems.forEach((item: any) => {
                const name = item.name || 'Product';
                const qty = item.quantity || 1;
                const price = formatCurrency(item.price);
                const total = formatCurrency(item.total);

                // Check for page break
                if (y > 700) {
                    doc.addPage();
                    y = 50;
                }

                doc.text(name, itemX, y, { width: 240 });
                doc.text(String(qty), qtyX, y);
                doc.text(price, priceX, y, { width: 70, align: 'right' });
                doc.text(total, totalX, y, { width: 70, align: 'right' });

                y += 20;
            });

            doc.moveTo(50, y + 10).lineTo(550, y + 10).stroke();

            // --- Totals ---
            y += 20;
            const totalLabelX = 350;
            const totalValueX = 450;

            doc.font('Helvetica-Bold');

            doc.text('Subtotal:', totalLabelX, y, { width: 90, align: 'right' });
            doc.text(formatCurrency(order.subtotal), totalValueX, y, { width: 70, align: 'right' });
            y += 20;

            doc.text('Shipping:', totalLabelX, y, { width: 90, align: 'right' });
            doc.text(formatCurrency(order.shippingTotal), totalValueX, y, { width: 70, align: 'right' });
            y += 20;

            doc.text('Tax:', totalLabelX, y, { width: 90, align: 'right' });
            doc.text(formatCurrency(order.taxTotal), totalValueX, y, { width: 70, align: 'right' });
            y += 25;

            doc.fontSize(12);
            doc.text('Total:', totalLabelX, y, { width: 90, align: 'right' });
            doc.text(formatCurrency(order.total), totalValueX, y, { width: 70, align: 'right' });

            // --- Footer ---
            const bottom = doc.page.height - 50;
            doc.fontSize(10).text('Thank you for your business!', 50, bottom, { align: 'center', width: 500 });

            doc.end();

            stream.on('finish', resolve);
            stream.on('error', reject);
        });
    }
}

