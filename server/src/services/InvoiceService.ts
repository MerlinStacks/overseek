
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

    async createTemplate(accountId: string, data: { name: string, layout: any }) {
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
     * Creates an HTML file that can be converted to PDF or served directly.
     * For full PDF generation, install pdfkit: npm install pdfkit @types/pdfkit
     */
    async generateInvoicePdf(accountId: string, orderId: string, templateId: string): Promise<string> {
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

        // 4. Generate HTML invoice
        const html = this.generateInvoiceHtml(order, billing, lineItems, template);

        // 5. Save as HTML file (can be printed to PDF by browser or converted)
        const fileName = `invoice-${order.number}-${Date.now()}.html`;
        const filePath = path.join(INVOICE_DIR, fileName);
        fs.writeFileSync(filePath, html, 'utf-8');

        Logger.info(`Invoice HTML saved`, { filePath });

        // Return relative URL to the file
        return `/uploads/invoices/${fileName}`;
    }

    /**
     * Generate HTML invoice from order data and template
     */
    private generateInvoiceHtml(order: any, billing: any, lineItems: any[], template: any): string {
        const formatCurrency = (val: any) => `$${parseFloat(val || 0).toFixed(2)}`;
        const formatDate = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        const itemRows = lineItems.map((item: any) => `
            <tr>
                <td>${item.name || 'Product'}</td>
                <td style="text-align: center;">${item.quantity || 1}</td>
                <td style="text-align: right;">${formatCurrency(item.price)}</td>
                <td style="text-align: right;">${formatCurrency(item.total)}</td>
            </tr>
        `).join('');

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Invoice #${order.number}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #333; }
        .invoice-header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .invoice-title { font-size: 28px; font-weight: bold; color: #1a1a1a; }
        .invoice-number { color: #666; margin-top: 5px; }
        .company-info { text-align: right; }
        .section { margin-bottom: 30px; }
        .section-title { font-size: 14px; color: #666; text-transform: uppercase; margin-bottom: 10px; }
        .bill-to { background: #f8f9fa; padding: 20px; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: #f0f0f0; padding: 12px; text-align: left; font-weight: 600; }
        td { padding: 12px; border-bottom: 1px solid #eee; }
        .totals { margin-top: 20px; text-align: right; }
        .totals-row { display: flex; justify-content: flex-end; gap: 40px; padding: 8px 0; }
        .totals-label { color: #666; }
        .totals-value { font-weight: 600; min-width: 100px; }
        .grand-total { font-size: 20px; border-top: 2px solid #333; padding-top: 15px; margin-top: 10px; }
        .footer { margin-top: 60px; text-align: center; color: #999; font-size: 12px; }
        @media print { body { padding: 20px; } }
    </style>
</head>
<body>
    <div class="invoice-header">
        <div>
            <div class="invoice-title">INVOICE</div>
            <div class="invoice-number">#${order.number}</div>
            <div style="margin-top: 10px; color: #666;">Date: ${formatDate(order.createdAt)}</div>
        </div>
        <div class="company-info">
            <div style="font-weight: bold; font-size: 18px;">${template.name || 'Your Company'}</div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Bill To</div>
        <div class="bill-to">
            <div style="font-weight: 600;">${billing.first_name || ''} ${billing.last_name || ''}</div>
            <div>${billing.address_1 || ''}</div>
            ${billing.address_2 ? `<div>${billing.address_2}</div>` : ''}
            <div>${billing.city || ''}, ${billing.state || ''} ${billing.postcode || ''}</div>
            <div>${billing.country || ''}</div>
            <div style="margin-top: 10px;">${billing.email || ''}</div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Order Items</div>
        <table>
            <thead>
                <tr>
                    <th>Item</th>
                    <th style="text-align: center;">Qty</th>
                    <th style="text-align: right;">Price</th>
                    <th style="text-align: right;">Total</th>
                </tr>
            </thead>
            <tbody>
                ${itemRows}
            </tbody>
        </table>
    </div>

    <div class="totals">
        <div class="totals-row">
            <span class="totals-label">Subtotal:</span>
            <span class="totals-value">${formatCurrency(order.subtotal)}</span>
        </div>
        <div class="totals-row">
            <span class="totals-label">Shipping:</span>
            <span class="totals-value">${formatCurrency(order.shippingTotal)}</span>
        </div>
        <div class="totals-row">
            <span class="totals-label">Tax:</span>
            <span class="totals-value">${formatCurrency(order.taxTotal)}</span>
        </div>
        <div class="totals-row grand-total">
            <span class="totals-label">Total:</span>
            <span class="totals-value">${formatCurrency(order.total)}</span>
        </div>
    </div>

    <div class="footer">
        <p>Thank you for your business!</p>
        <p>Generated by Overseek</p>
    </div>
</body>
</html>
        `.trim();
    }
}

