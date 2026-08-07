import fs from 'fs';
import path from 'path';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AuditActions, AuditService } from '../AuditService';
import { renderWholesaleCatalog } from './renderer';
import { rasterizePdf } from './shareWorker';
import { WholesaleSnapshot } from './snapshot';
import { generationValidityArtifactPaths, shareValidityArtifactPaths } from './storage';

type ValidityJob = { generationId: string; accountId: string; validUntil: string; validityRevision: number };

export function snapshotWithValidity(snapshot: WholesaleSnapshot, validUntil: Date, validityRevision: number): WholesaleSnapshot {
    return { ...snapshot, validUntil: validUntil.toISOString(), validityRevision };
}

async function removeDirectories(directories: string[]) {
    await Promise.allSettled(directories.map(directory => fs.promises.rm(directory, { recursive: true, force: true })));
}

export class WholesaleCatalogValidityWorker {
    static async process(job: any) {
        const data = job.data as Partial<ValidityJob>;
        if (!data.generationId || !data.accountId || !data.validUntil || !Number.isInteger(data.validityRevision)) throw new Error('Invalid wholesale validity job payload');
        const validUntil = new Date(data.validUntil);
        if (Number.isNaN(validUntil.getTime())) throw new Error('Invalid wholesale validity date');
        const generation = await (prisma as any).wholesaleCatalogGeneration.findFirst({
            where: { id: data.generationId, accountId: data.accountId }, include: { catalog: true },
        });
        if (!generation || generation.status !== 'APPROVED' || generation.staleAt || generation.validityArtifactStatus !== 'UPDATING' || data.validityRevision !== generation.validityRevision + 1) return;
        const now = new Date();
        const shares = await (prisma as any).wholesaleCatalogShare.findMany({
            where: { generationId: generation.id, accountId: data.accountId, revokedAt: null, expiresAt: { gt: now } },
            include: { catalog: true }, orderBy: { id: 'asc' },
        });
        const snapshot = snapshotWithValidity(generation.inputSnapshot as WholesaleSnapshot, validUntil, data.validityRevision);
        const masterTemporary = generationValidityArtifactPaths(generation.id, data.validityRevision, true);
        const masterFinal = generationValidityArtifactPaths(generation.id, data.validityRevision);
        const temporaryDirectories = [masterTemporary.directory, ...shares.map((share: any) => shareValidityArtifactPaths(share.id, data.validityRevision, true).directory)];
        const finalDirectories = [masterFinal.directory, ...shares.map((share: any) => shareValidityArtifactPaths(share.id, data.validityRevision).directory)];
        const deadline = Date.now() + 30 * 60 * 1000;
        try {
            await removeDirectories([...temporaryDirectories, ...finalDirectories]);
            const masterResult = await renderWholesaleCatalog(snapshot, masterTemporary.pdf, { deadline, checkCancelled: async () => {} });
            const renderedShares: Array<{ share: any; pageCount: number; temporary: ReturnType<typeof shareValidityArtifactPaths>; final: ReturnType<typeof shareValidityArtifactPaths> }> = [];
            for (const share of shares) {
                const temporary = shareValidityArtifactPaths(share.id, data.validityRevision, true);
                const final = shareValidityArtifactPaths(share.id, data.validityRevision);
                await Promise.all([temporary.pages, temporary.thumbnails].map(directory => fs.promises.mkdir(directory, { recursive: true })));
                const customer = share.customerSnapshot as any;
                const result = await renderWholesaleCatalog(snapshot, temporary.pdf, {
                    deadline, checkCancelled: async () => {},
                    personalization: { company: customer.company, contact: customer.contact, confidentialityText: share.confidentialityTextSnapshot },
                });
                const raster = await rasterizePdf(temporary.pdf, temporary.pages, temporary.thumbnails, deadline, result.pageCount);
                renderedShares.push({ share, pageCount: raster.pageCount, temporary, final });
            }
            await fs.promises.mkdir(path.dirname(masterFinal.directory), { recursive: true });
            await fs.promises.rename(masterTemporary.directory, masterFinal.directory);
            for (const item of renderedShares) await fs.promises.rename(item.temporary.directory, item.final.directory);
            const stat = await fs.promises.stat(masterFinal.pdf);
            const switched = await (prisma as any).$transaction(async (tx: any) => {
                const updated = await tx.wholesaleCatalogGeneration.updateMany({
                    where: { id: generation.id, accountId: data.accountId, status: 'APPROVED', staleAt: null, validityArtifactStatus: 'UPDATING', validityRevision: generation.validityRevision },
                    data: {
                        validUntil, inputSnapshot: snapshot, validityRevision: data.validityRevision, validityArtifactStatus: 'CURRENT',
                        masterFilePath: masterFinal.pdf, fileSize: stat.size, pageCount: masterResult.pageCount, errorMessage: null,
                    },
                });
                if (updated.count !== 1) throw new Error('Generation validity changed during artifact update');
                for (const item of renderedShares) {
                    const customer = item.share.customerSnapshot as any;
                    await tx.wholesaleCatalogShare.updateMany({
                        where: { id: item.share.id, generationId: generation.id, revokedAt: null, expiresAt: { gt: now } },
                        data: { artifactStatus: 'READY', artifactError: null, personalizedPdfPath: item.final.pdf, personalizedPagesPath: item.final.pages, customerSnapshot: { ...customer, pageCount: item.pageCount } },
                    });
                }
                return true;
            }, { isolationLevel: 'Serializable' });
            if (!switched) throw new Error('Validity artifact switch failed');
            await AuditService.log(data.accountId, null, AuditActions.WHOLESALE_VALIDITY_EXTENSION_COMPLETED, 'WHOLESALE_CATALOG_GENERATION', generation.id, {
                validUntil, validityRevision: data.validityRevision, shareCount: renderedShares.length,
            });
        } catch (error: any) {
            await removeDirectories([...temporaryDirectories, ...finalDirectories]);
            await (prisma as any).wholesaleCatalogGeneration.updateMany({
                where: { id: generation.id, accountId: data.accountId, validityArtifactStatus: 'UPDATING', validityRevision: generation.validityRevision },
                data: { validityArtifactStatus: 'FAILED', errorMessage: 'Validity artifact update failed' },
            });
            await AuditService.log(data.accountId, null, AuditActions.WHOLESALE_VALIDITY_EXTENSION_FAILED, 'WHOLESALE_CATALOG_GENERATION', generation.id, { validityRevision: data.validityRevision });
            Logger.error('[WholesaleValidityWorker] Artifact update failed', { generationId: generation.id, error: String(error?.message || error) });
            throw error;
        }
    }
}
