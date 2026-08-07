import fs from 'fs';
import path from 'path';
import { prisma } from '../../utils/prisma';
import { AuditActions, AuditService } from '../AuditService';
import { Logger } from '../../utils/logger';
import { renderWholesaleCatalog } from './renderer';
import { WholesaleSnapshot } from './snapshot';
import { generationPdfPath } from './storage';

class GenerationCancelledError extends Error {}

async function cleanup(filePath: string) {
    try { await fs.promises.rm(path.dirname(filePath), { recursive: true, force: true }); }
    catch (error) { Logger.warn('[WholesaleCatalogWorker] Private file cleanup failed', { error }); }
}

export class WholesaleCatalogWorker {
    static async process(job: any) {
        const { generationId, accountId } = job.data as { generationId?: string; accountId?: string };
        if (!generationId || !accountId) throw new Error('Invalid wholesale generation job payload');
        const claimed = await (prisma as any).wholesaleCatalogGeneration.updateMany({
            where: { id: generationId, accountId, status: 'QUEUED', cancelRequestedAt: null },
            data: { status: 'RENDERING', startedAt: new Date(), progressStage: 'STARTING', progressPercent: 1, errorMessage: null },
        });
        if (claimed.count !== 1) return;
        const generation = await (prisma as any).wholesaleCatalogGeneration.findFirst({ where: { id: generationId, accountId } });
        if (!generation) return;
        const temporaryPath = generationPdfPath(generation.id, true);
        const finalPath = generationPdfPath(generation.id);
        const deadline = Date.now() + 30 * 60 * 1000;
        const checkCancelled = async () => {
            if (Date.now() >= deadline) throw new Error('Generation exceeded the 30 minute timeout');
            const state = await (prisma as any).wholesaleCatalogGeneration.findFirst({ where: { id: generation.id, accountId }, select: { cancelRequestedAt: true } });
            if (!state || state.cancelRequestedAt) throw new GenerationCancelledError('Generation cancelled');
        };
        try {
            await fs.promises.rm(temporaryPath, { force: true });
            const result = await renderWholesaleCatalog(generation.inputSnapshot as WholesaleSnapshot, temporaryPath, {
                deadline,
                checkCancelled,
                onProgress: async (stage, percent) => {
                    await job.updateProgress(percent);
                    await (prisma as any).wholesaleCatalogGeneration.updateMany({ where: { id: generation.id, status: 'RENDERING' }, data: { progressStage: stage, progressPercent: percent } });
                },
            });
            await checkCancelled();
            await fs.promises.rename(temporaryPath, finalPath);
            const stat = await fs.promises.stat(finalPath);
            const completed = await (prisma as any).$transaction(async (tx: any) => {
                const latest = await tx.wholesaleCatalogGeneration.aggregate({
                    where: { catalogId: generation.catalogId, versionNumber: { not: null } }, _max: { versionNumber: true },
                });
                const finalized = await tx.wholesaleCatalogGeneration.updateMany({ where: { id: generation.id, accountId, status: 'RENDERING', cancelRequestedAt: null }, data: {
                    status: 'AWAITING_APPROVAL', versionNumber: (latest._max.versionNumber || 0) + 1,
                    masterFilePath: finalPath, fileSize: stat.size, pageCount: result.pageCount,
                    progressStage: 'AWAITING_APPROVAL', progressPercent: 100, completedAt: new Date(), originalGeneratedAt: new Date(),
                } });
                if (finalized.count !== 1) return null;
                return tx.wholesaleCatalogGeneration.findUnique({ where: { id: generation.id } });
            }, { isolationLevel: 'Serializable' });
            if (!completed) {
                await cleanup(finalPath);
                const cancelled = await (prisma as any).wholesaleCatalogGeneration.updateMany({
                    where: { id: generation.id, accountId, status: 'RENDERING', cancelRequestedAt: { not: null } },
                    data: { status: 'CANCELLED', completedAt: new Date(), progressStage: 'CANCELLED', errorMessage: null, masterFilePath: null, basePagesPath: null },
                });
                if (cancelled.count) {
                    await AuditService.log(accountId, generation.requestedById, AuditActions.WHOLESALE_GENERATION_CANCELLED, 'WHOLESALE_CATALOG_GENERATION', generation.id, {});
                }
                return;
            }
            await AuditService.log(accountId, null, AuditActions.WHOLESALE_GENERATION_COMPLETED, 'WHOLESALE_CATALOG_GENERATION', generation.id, {
                versionNumber: completed.versionNumber, pageCount: result.pageCount, warningCodes: result.warnings,
            });
            try {
                await (prisma as any).notification.create({ data: {
                    accountId, title: 'Wholesale catalog ready', message: 'Your wholesale catalog is ready for approval.',
                    type: result.warnings.length ? 'WARNING' : 'SUCCESS', link: `/wholesale-catalog/${generation.catalogId}`,
                } });
            } catch (error) { Logger.warn('[WholesaleCatalogWorker] Notification failed', { generationId, error }); }
        } catch (error: any) {
            await cleanup(temporaryPath);
            const cancelled = error instanceof GenerationCancelledError;
            const terminal = await (prisma as any).wholesaleCatalogGeneration.updateMany({ where: {
                id: generation.id, accountId, status: 'RENDERING',
                ...(cancelled ? {} : { cancelRequestedAt: null }),
            }, data: {
                status: cancelled ? 'CANCELLED' : 'FAILED', completedAt: new Date(), progressStage: cancelled ? 'CANCELLED' : 'FAILED',
                errorMessage: cancelled ? null : 'Catalog rendering failed', masterFilePath: null, basePagesPath: null,
            } });
            if (terminal.count !== 1) return;
            await AuditService.log(accountId, cancelled ? generation.requestedById : null,
                cancelled ? AuditActions.WHOLESALE_GENERATION_CANCELLED : AuditActions.WHOLESALE_GENERATION_FAILED,
                'WHOLESALE_CATALOG_GENERATION', generation.id, cancelled ? {} : { failureType: error?.name || 'Error' });
            if (!cancelled) {
                try {
                    await (prisma as any).notification.create({ data: {
                        accountId, title: 'Wholesale catalog failed', message: 'Your wholesale catalog could not be generated. You can retry the saved snapshot.',
                        type: 'ERROR', link: `/wholesale-catalog/${generation.catalogId}`,
                    } });
                } catch (notificationError) { Logger.warn('[WholesaleCatalogWorker] Failure notification failed', { generationId, error: notificationError }); }
            }
            if (!cancelled) throw error;
        }
    }
}
