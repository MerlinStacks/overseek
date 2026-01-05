
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

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
     * For now, this mimics the behavior by returning a mock URL or path.
     * In a real implementation with Puppeteer/Playwright support, 
     * this would launch a browser, render the template with data, and print to PDF.
     */
    async generateInvoicePdf(accountId: string, orderId: string, templateId: string): Promise<string> {
        // 1. Fetch Order Data
        const order = await prisma.wooOrder.findUnique({
            where: { id: orderId } // Or wooId depending on context. Assuming internal UUID for now.
        });

        if (!order) throw new Error("Order not found");

        // 2. Fetch Template
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id: templateId, accountId }
        });

        if (!template) throw new Error("Invoice Template not found");

        console.log(`[InvoiceService] Generating PDF for Order ${order.number} using Template ${template.name}`);

        // TODO: Implement actual PDF generation logic.
        // Option 1: Render HTML string from Template Layout + Order Data -> Send to Puppeteer
        // Option 2: Use a library like pdfmake (server-side)

        // Mock Implementation:
        // Create a dummy file in a public/temp directory
        const fileName = `invoice-${order.number}-${Date.now()}.pdf`;
        // In a real app, upload to S3 or similar.

        return `https://api.overseek.app/files/invoices/${fileName}`;
    }
}
