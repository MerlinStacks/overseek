import fs from 'fs';
import { createHash } from 'crypto';
import type { InvoiceArtifact } from '@prisma/client';
import { QueueFactory, QUEUES } from './queue/QueueFactory';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { InvoiceService } from './InvoiceService';

const invoiceService = new InvoiceService();

function normalizeTemplateVersion(layout: any): string {
    const versions = Array.isArray(layout?.versions) ? layout.versions : [];
    const latest = versions[0];
    if (latest?.id) return String(latest.id);
    return 'current';
}

function getLayoutHash(layout: any): string {
    const serialized = typeof layout === 'string' ? layout : JSON.stringify(layout ?? {});
    return createHash('sha256').update(serialized).digest('hex');
}

export class CanonicalInvoiceService {
    async getOrQueue(accountId: string, orderId: string) {
        const template = await prisma.invoiceTemplate.findFirst({
            where: { accountId },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, layout: true }
        });

        if (!template) {
            throw new Error('No invoice template found for account');
        }

        const templateVersion = normalizeTemplateVersion(template.layout);
        const layoutHash = getLayoutHash(template.layout);

        let artifact = await prisma.invoiceArtifact.findUnique({
            where: {
                accountId_orderId_templateVersion_layoutHash: {
                    accountId,
                    orderId,
                    templateVersion,
                    layoutHash
                }
            }
        });

        const readyAndReadable = artifact?.status === 'ready'
            && !!artifact.storagePath
            && fs.existsSync(artifact.storagePath);
        if (readyAndReadable) {
            return artifact;
        }

        if (!artifact) {
            artifact = await prisma.invoiceArtifact.create({
                data: {
                    accountId,
                    orderId,
                    templateId: template.id,
                    templateVersion,
                    layoutHash,
                    renderer: 'designer-capture',
                    status: 'pending'
                }
            });
        } else if (artifact.status === 'failed' || !artifact.storagePath) {
            artifact = await prisma.invoiceArtifact.update({
                where: { id: artifact.id },
                data: {
                    status: 'pending',
                    errorMessage: null
                }
            });
        }

        await this.enqueueGeneration(artifact.id, accountId, orderId, template.id);
        return artifact;
    }

    async enqueueGeneration(artifactId: string, accountId: string, orderId: string, templateId: string): Promise<void> {
        const queue = QueueFactory.getQueue(QUEUES.INVOICE_CANONICAL_GENERATE);
        await queue.add('generate-canonical-invoice', {
            artifactId,
            accountId,
            orderId,
            templateId
        }, {
            jobId: `invoice-canonical:${artifactId}`
        });
    }

    async processGenerationJob(data: { artifactId: string; accountId: string; orderId: string; templateId: string }): Promise<void> {
        const artifact = await prisma.invoiceArtifact.findFirst({
            where: {
                id: data.artifactId,
                accountId: data.accountId,
                orderId: data.orderId
            }
        });

        if (!artifact) {
            Logger.warn('[CanonicalInvoiceService] Artifact missing for generation job', data);
            return;
        }

        try {
            const allowPdfkitFallback = process.env.INVOICE_CANONICAL_FALLBACK_PDFKIT !== 'false';
            if (!allowPdfkitFallback) {
                throw new Error('Canonical renderer unavailable and PDFKit fallback disabled');
            }

            const generated = await invoiceService.generateInvoicePdf(data.accountId, data.orderId, data.templateId);
            const stat = fs.statSync(generated.absolutePath);
            const rendererUsed = 'pdfkit-fallback';

            await prisma.invoiceArtifact.update({
                where: { id: artifact.id },
                data: {
                    status: 'ready',
                    renderer: rendererUsed,
                    storagePath: generated.absolutePath,
                    fileSize: Number(stat.size || 0),
                    generatedAt: new Date(),
                    errorMessage: null
                }
            });

            Logger.info('[CanonicalInvoiceService] Invoice artifact ready', {
                artifactId: artifact.id,
                accountId: data.accountId,
                orderId: data.orderId,
                rendererUsed
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await prisma.invoiceArtifact.update({
                where: { id: artifact.id },
                data: {
                    status: 'failed',
                    renderer: 'pdfkit-fallback',
                    errorMessage: message
                }
            });

            Logger.error('[CanonicalInvoiceService] Failed to generate invoice artifact', {
                artifactId: artifact.id,
                accountId: data.accountId,
                orderId: data.orderId,
                error: message
            });

            throw error;
        }
    }

    async getArtifactById(id: string): Promise<InvoiceArtifact | null> {
        return prisma.invoiceArtifact.findFirst({ where: { id } });
    }

    async waitForReady(artifactId: string, maxWaitMs = 2000, intervalMs = 250): Promise<InvoiceArtifact | null> {
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
            const artifact = await this.getArtifactById(artifactId);
            if (!artifact) return null;
            if (artifact.status === 'ready' || artifact.status === 'failed') {
                return artifact;
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        return this.getArtifactById(artifactId);
    }

    isReadableReady(artifact: InvoiceArtifact | null): artifact is InvoiceArtifact & { storagePath: string } {
        return !!artifact && artifact.status === 'ready' && !!artifact.storagePath && fs.existsSync(artifact.storagePath);
    }

}

export const canonicalInvoiceService = new CanonicalInvoiceService();
