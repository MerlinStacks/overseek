import fs from 'fs';
import path from 'path';
import { createHmac } from 'crypto';

type CanonicalRenderInput = {
    accountId: string;
    orderId: string;
    templateId: string;
    artifactId: string;
};

export class CanonicalBrowserInvoiceService {
    private getSigningSecret(): string {
        return String(
            process.env.INVOICE_CANONICAL_SIGNING_SECRET
            || process.env.RELAY_WEBHOOK_SECRET
            || process.env.JWT_SECRET
            || 'overseek-canonical-invoice-secret'
        );
    }

    private signPayload(artifactId: string, expiresAt: number): string {
        const secret = this.getSigningSecret();
        return createHmac('sha256', secret)
            .update(`${artifactId}:${expiresAt}`)
            .digest('hex');
    }

    async renderPdf(input: CanonicalRenderInput): Promise<{ absolutePath: string; rendererUsed: string }> {
        const clientUrl = String(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
        const expiresAt = Date.now() + 5 * 60 * 1000;
        const signature = this.signPayload(input.artifactId, expiresAt);
        const printUrl = `${clientUrl}/invoices/canonical-print/${encodeURIComponent(input.artifactId)}?expires=${expiresAt}&sig=${signature}`;

        const playwright = await (new Function('return import("playwright")')() as Promise<any>);
        const chromium = playwright.chromium;
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        try {
            const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
            await page.goto(printUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('[data-canonical-invoice-ready="1"]', { timeout: 20000 });
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
