import fs from 'fs';
import { createHash } from 'crypto';
import type { InvoiceArtifact } from '@prisma/client';
import { QueueFactory, QUEUES } from './queue/QueueFactory';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { InvoiceService } from './InvoiceService';

const invoiceService = new InvoiceService();
const OPERATIONAL_A4_RENDERER_VERSION = 'operational-a4-v3';

function isCanonicalRenderer(renderer: string | null | undefined): boolean {
    return renderer === 'pdfkit-primary'
        || renderer === 'pdfkit-fallback';
}

function normalizeTemplateVersion(layout: any): string {
    const versions = Array.isArray(layout?.versions) ? layout.versions : [];
    const latest = versions[0];
    if (latest?.id) return String(latest.id);
    return 'current';
}

function getLayoutHash(layout: any): string {
    const serialized = typeof layout === 'string' ? layout : JSON.stringify(layout ?? {});
    return createHash('sha256')
        .update(`${OPERATIONAL_A4_RENDERER_VERSION}:${serialized}`)
        .digest('hex');
}

export class CanonicalInvoiceService {
    private getInvalidateBeforeDate(): Date | null {
        const raw = String(process.env.INVOICE_CANONICAL_INVALIDATE_BEFORE || '').trim();
        if (!raw) return null;
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed;
    }

    private getStaleReason(artifact: InvoiceArtifact | null, forceRegenerate: boolean): string | null {
        if (forceRegenerate) return 'forced_refresh';
        if (!artifact) return 'missing_artifact';
        if (artifact.status !== 'ready') return 'not_ready';
        if (!artifact.storagePath || !fs.existsSync(artifact.storagePath)) return 'missing_file';
        if (!isCanonicalRenderer(artifact.renderer)) return 'non_canonical_renderer';

        const invalidateBefore = this.getInvalidateBeforeDate();
        if (invalidateBefore && artifact.generatedAt && artifact.generatedAt < invalidateBefore) {
            return 'generated_before_cutoff';
        }

        return null;
    }

    async getOrQueue(accountId: string, orderId: string, options: { forceRegenerate?: boolean } = {}) {
        const forceRegenerate = options.forceRegenerate === true;
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

        const staleReason = this.getStaleReason(artifact, forceRegenerate);
        const readyAndReadable = !staleReason;
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
                    renderer: 'pending',
                    status: 'pending'
                }
            });
        } else if (forceRegenerate || artifact.status === 'failed' || !artifact.storagePath) {
            artifact = await prisma.invoiceArtifact.update({
                where: { id: artifact.id },
                data: {
                    status: 'pending',
                    errorMessage: null,
                    generatedAt: null
                }
            });
        }

        await this.enqueueGeneration(artifact.id, accountId, orderId, template.id, { forceRegenerate });
        return artifact;
    }

    async enqueueGeneration(
        artifactId: string,
        accountId: string,
        orderId: string,
        templateId: string,
        options: { forceRegenerate?: boolean } = {}
    ): Promise<void> {
        const queue = QueueFactory.getQueue(QUEUES.INVOICE_CANONICAL_GENERATE);
        const safeArtifactId = artifactId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const forceRegenerate = options.forceRegenerate === true;
        const jobId = forceRegenerate
            ? `invoice-canonical_${safeArtifactId}_force_${Date.now()}`
            : `invoice-canonical_${safeArtifactId}`;

        await queue.add('generate-canonical-invoice', {
            artifactId,
            accountId,
            orderId,
            templateId,
            forceRegenerate
        }, {
            jobId
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
            let generatedPath = '';
            let rendererUsed = 'pdfkit-primary';

            const generated = await invoiceService.generateInvoicePdf(data.accountId, data.orderId, data.templateId, {
                layoutMode: 'operational-a4',
            });
            generatedPath = generated.absolutePath;
            rendererUsed = 'pdfkit-primary';

            const stat = fs.statSync(generatedPath);

            await prisma.invoiceArtifact.update({
                where: { id: artifact.id },
                data: {
                    status: 'ready',
                    renderer: rendererUsed,
                    storagePath: generatedPath,
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
                    renderer: artifact.renderer,
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
