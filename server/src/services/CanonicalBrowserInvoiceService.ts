import fs from 'fs';
import path from 'path';
import { mergeInvoiceSettings } from '@overseek/core';
import { prisma } from '../utils/prisma';

type CanonicalRenderInput = {
    accountId: string;
    orderId: string;
    templateId: string;
    artifactId: string;
};

export class CanonicalBrowserInvoiceService {
    async renderPdf(input: CanonicalRenderInput): Promise<{ absolutePath: string; rendererUsed: string }> {
        const clientUrl = String(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
        const orderNum = Number(input.orderId);

        const order = await prisma.wooOrder.findFirst({
            where: {
                accountId: input.accountId,
                OR: [
                    { id: input.orderId },
                    ...(Number.isFinite(orderNum) ? [{ wooId: orderNum }] : [])
                ]
            }
        });
        if (!order) throw new Error('Order not found for canonical rendering');

        const template = await prisma.invoiceTemplate.findFirst({
            where: { id: input.templateId, accountId: input.accountId }
        });
        if (!template) throw new Error('Invoice template not found for canonical rendering');

        const rawLayout = typeof template.layout === 'string' ? JSON.parse(template.layout) : (template.layout || {});
        const settings = mergeInvoiceSettings(rawLayout.settings || {});
        const layout = Array.isArray(rawLayout.grid) ? rawLayout.grid : [];
        const items = Array.isArray(rawLayout.items) ? rawLayout.items : [];
        const rawOrder = (order.rawData as any) || {};
        const payload = {
            layout,
            items,
            settings,
            order: {
                ...rawOrder,
                id: order.id,
                number: order.number,
                order_number: order.number,
                total: order.total,
                shipping_total: rawOrder.shipping_total ?? 0,
                tax_total: rawOrder.total_tax ?? 0,
                date_created: rawOrder.date_created || order.createdAt,
            }
        };

        const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
        const printUrl = `${clientUrl}/invoices/canonical-print?payload=${encodeURIComponent(encodedPayload)}`;

        const playwright = await (new Function('return import("playwright")')() as Promise<any>);
        const chromium = playwright.chromium;
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        try {
            const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
            await page.goto(printUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForSelector('[data-canonical-invoice-ready="1"]', { timeout: 15000 });
            await page.waitForTimeout(300);

            const outDir = path.join(__dirname, '../../uploads/invoices/canonical');
            if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, `invoice-canonical-${input.artifactId}.pdf`);

            await page.pdf({
                path: outPath,
                printBackground: true,
                width: '210mm',
                height: '297mm',
                margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
                preferCSSPageSize: true,
            });

            return { absolutePath: outPath, rendererUsed: 'designer-capture-browser' };
        } finally {
            await browser.close();
        }
    }
}

export const canonicalBrowserInvoiceService = new CanonicalBrowserInvoiceService();
