import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { generationPdfPath, shareArtifactPaths } from './storage';

const DAY = 24 * 60 * 60 * 1000;

function plusDays(value: Date, days: number) {
    return new Date(value.getTime() + days * DAY);
}

function latest(values: Array<Date | null | undefined>) {
    const dates = values.filter((value): value is Date => value instanceof Date);
    return dates.length ? new Date(Math.max(...dates.map(value => value.getTime()))) : null;
}

export function generationArtifactRemovalDate(generation: any, shares: any[] = []) {
    if (generation.status !== 'APPROVED') {
        return plusDays(generation.completedAt || generation.updatedAt || generation.createdAt, 7);
    }
    if (!shares.length) return generation.approvedAt ? plusDays(generation.approvedAt, 90) : null;
    const lastShareEnd = latest(shares.flatMap(share => [share.expiresAt, share.revokedAt]));
    return lastShareEnd ? plusDays(lastShareEnd, 90) : null;
}

export function shareArtifactRemovalDate(share: any) {
    const end = latest([share.expiresAt, share.revokedAt]);
    return end ? plusDays(end, 90) : null;
}

export function shareEvidenceAnonymizationDate(share: any) {
    const result = new Date(share.expiresAt);
    result.setUTCMonth(result.getUTCMonth() + 12);
    return result;
}

export class WholesaleRetentionService {
    static async cleanup(now = new Date()) {
        const generations = await (prisma as any).wholesaleCatalogGeneration.findMany({ include: { shares: true } });
        const shares = await (prisma as any).wholesaleCatalogShare.findMany();
        let generationArtifacts = 0;
        let shareArtifacts = 0;
        let anonymizedShares = 0;

        for (const generation of generations) {
            const removeAt = generationArtifactRemovalDate(generation, generation.shares);
            if (!removeAt || removeAt > now || (!generation.masterFilePath && !generation.basePagesPath)) continue;
            const directory = path.dirname(generationPdfPath(generation.id));
            await fs.promises.rm(directory, { recursive: true, force: true });
            await (prisma as any).wholesaleCatalogGeneration.update({
                where: { id: generation.id }, data: { masterFilePath: null, basePagesPath: null, fileSize: null },
            });
            generationArtifacts++;
        }

        for (const share of shares) {
            const removeAt = shareArtifactRemovalDate(share);
            if (removeAt <= now && (share.personalizedPdfPath || share.personalizedPagesPath)) {
                await fs.promises.rm(shareArtifactPaths(share.id).directory, { recursive: true, force: true });
                await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: {
                    personalizedPdfPath: null,
                    personalizedPagesPath: null,
                    personalizedFileName: null,
                    artifactStatus: 'EXPIRED',
                } });
                shareArtifacts++;
            }
            if (shareEvidenceAnonymizationDate(share) > now) continue;
            const viewers = await (prisma as any).wholesaleCatalogViewer.findMany({ where: { shareId: share.id, anonymizedAt: null }, select: { id: true } });
            await (prisma as any).$transaction([
                ...viewers.map((viewer: any) => (prisma as any).wholesaleCatalogViewer.update({ where: { id: viewer.id }, data: {
                    name: 'Anonymized viewer', email: `anonymized-${viewer.id}@redacted.invalid`, anonymizedAt: now,
                } })),
                (prisma as any).wholesaleCatalogViewerSession.updateMany({ where: { shareId: share.id }, data: {
                    ipAddress: null, userAgent: null, deviceSummary: null,
                } }),
                (prisma as any).wholesaleCatalogAccessLog.updateMany({ where: { shareId: share.id }, data: {
                    ipAddress: null, userAgent: null, metadata: Prisma.DbNull,
                } }),
            ]);
            if (viewers.length) anonymizedShares++;
        }
        return { generationArtifacts, shareArtifacts, anonymizedShares };
    }
}
