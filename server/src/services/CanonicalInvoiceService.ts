import fs from 'fs';
import path from 'path';
import { getUploadsDir } from '../utils/uploadPaths';
import { createHash } from 'crypto';
import type { InvoiceArtifact } from '@prisma/client';
import { QueueFactory, QUEUES } from './queue/QueueFactory';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { InvoiceService } from './InvoiceService';

const invoiceService = new InvoiceService();
const OPERATIONAL_A4_RENDERER_VERSION = 'operational-a4-v6';

export class MissingInvoiceTemplateError extends Error {
    constructor() {
        super('No invoice template found for account');
        this.name = 'MissingInvoiceTemplateError';
    }
}

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
    const normalized = typeof layout === 'string' ? JSON.parse(layout) : structuredClone(layout ?? {});
    if (normalized.settings?.numbering) delete normalized.settings.numbering.nextNumber;
    const serialized = JSON.stringify(normalized);
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
        if (!this.isReadableReady(artifact)) return 'invalid_file';
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
            throw new MissingInvoiceTemplateError();
        }

        const order = await prisma.wooOrder.findFirst({ where: { accountId, OR: [{ id: orderId }, ...(/^\d+$/.test(orderId) && Number.isSafeInteger(Number(orderId)) ? [{ wooId: Number(orderId) }] : [])] }, select: { id: true, updatedAt: true } });
        if (!order) throw new Error('Scoped invoice order unavailable');
        orderId = order.id;
        const templateVersion = normalizeTemplateVersion(template.layout);
        const layoutHash = createHash('sha256').update(`${template.id}:${getLayoutHash(template.layout)}:${order.updatedAt.toISOString()}`).digest('hex');

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
            artifact = await prisma.invoiceArtifact.upsert({
                where: { accountId_orderId_templateVersion_layoutHash: { accountId, orderId, templateVersion, layoutHash } },
                update: {},
                create: {
                    accountId,
                    orderId,
                    templateId: template.id,
                    templateVersion,
                    layoutHash,
                    renderer: 'pending',
                    status: 'pending'
                }
            });
        } else if (artifact.status !== 'pending') {
            // Never reset an in-flight or uncertain generation to retry it blindly.
            if (forceRegenerate || artifact.status === 'ready') throw Object.assign(new Error('Existing artifact requires explicit reconciliation; automatic regeneration is disabled'), { statusCode: 409 });
            return artifact;
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
                orderId: data.orderId,
                templateId: data.templateId
            }
        });

        if (!artifact) {
            Logger.warn('[CanonicalInvoiceService] Artifact missing for generation job', data);
            return;
        }

        const scope = { id: artifact.id, accountId: artifact.accountId, orderId: artifact.orderId, templateId: artifact.templateId, templateVersion: artifact.templateVersion, layoutHash: artifact.layoutHash };
        const claim = await prisma.invoiceArtifact.updateMany({ where: { ...scope, status: 'pending', updatedAt: artifact.updatedAt }, data: { status: 'generating' } });
        if (claim.count !== 1) return;
        try {
            const [template, order] = await Promise.all([prisma.invoiceTemplate.findFirst({ where: { id: artifact.templateId, accountId: artifact.accountId } }), prisma.wooOrder.findFirst({ where: { id: artifact.orderId, accountId: artifact.accountId } })]);
            if (!template || !order || normalizeTemplateVersion(template.layout) !== artifact.templateVersion || createHash('sha256').update(`${template.id}:${getLayoutHash(template.layout)}:${order.updatedAt.toISOString()}`).digest('hex') !== artifact.layoutHash) throw new Error('Invoice source changed; request a current artifact');
            let generatedPath = '';
            let rendererUsed = 'pdfkit-primary';

            const generated = await invoiceService.generateInvoicePdf(data.accountId, data.orderId, data.templateId, {
                layoutMode: 'operational-a4',
                expectedTemplateUpdatedAt: template.updatedAt,
                expectedOrderUpdatedAt: order.updatedAt,
            });
            generatedPath = generated.absolutePath;
            rendererUsed = 'pdfkit-primary';

            const stat = fs.statSync(generatedPath);
            if (!this.isReadableReady({ ...artifact, status: 'ready', renderer: rendererUsed, storagePath: generatedPath, fileSize: stat.size, generatedAt: new Date() })) throw new Error('Generated PDF failed artifact validation');

            await prisma.invoiceArtifact.updateMany({
                where: { ...scope, status: 'generating' },
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
            await prisma.invoiceArtifact.updateMany({
                where: { ...scope, status: 'generating' },
                data: {
                    status: 'uncertain',
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

    async waitForReady(identity: Pick<InvoiceArtifact, 'id' | 'accountId' | 'orderId' | 'templateId' | 'templateVersion' | 'layoutHash'>, maxWaitMs = 2000, intervalMs = 250): Promise<InvoiceArtifact | null> {
        if (!identity?.id || !identity.accountId || !identity.orderId || !identity.templateId || !identity.templateVersion || !identity.layoutHash) throw new Error('Scoped immutable artifact identity required');
        if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0 || maxWaitMs > 15000 || !Number.isFinite(intervalMs) || intervalMs < 50 || intervalMs > 1000) throw new Error('Invalid invoice wait bounds');
        const read = () => prisma.invoiceArtifact.findFirst({ where: { id: identity.id, accountId: identity.accountId, orderId: identity.orderId, templateId: identity.templateId, templateVersion: identity.templateVersion, layoutHash: identity.layoutHash } });
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
            const artifact = await read();
            if (!artifact) return null;
            if (['ready', 'failed', 'uncertain'].includes(artifact.status)) {
                return artifact;
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        return read();
    }

    isReadableReady(artifact: InvoiceArtifact | null): artifact is InvoiceArtifact & { storagePath: string; status: 'ready' } {
        if (!artifact || artifact.status !== 'ready' || !artifact.storagePath || !/^[a-zA-Z0-9_-]{1,200}$/.test(artifact.accountId) || !artifact.orderId || !artifact.templateId || !artifact.layoutHash || !artifact.templateVersion || !isCanonicalRenderer(artifact.renderer) || artifact.mimeType !== 'application/pdf' || !artifact.generatedAt) return false;
        try {
            const base = fs.realpathSync(path.join(getUploadsDir(), 'invoices'));
            const root = fs.realpathSync(path.join(base, artifact.accountId));
            if (root !== path.join(base, artifact.accountId) || fs.lstatSync(path.join(base, artifact.accountId)).isSymbolicLink()) return false;
            const file = fs.realpathSync(artifact.storagePath), stat = fs.lstatSync(artifact.storagePath);
            if (!file.startsWith(root + path.sep) || !stat.isFile() || stat.isSymbolicLink() || stat.size < 5 || stat.size > 25 * 1024 * 1024 || artifact.fileSize !== stat.size || path.extname(file) !== '.pdf') return false;
            const fd = fs.openSync(file, 'r');
            try { const header = Buffer.alloc(5); fs.readSync(fd, header, 0, 5, 0); return header.toString('ascii') === '%PDF-'; } finally { fs.closeSync(fd); }
        } catch { return false; }
    }

}

export const canonicalInvoiceService = new CanonicalInvoiceService();
