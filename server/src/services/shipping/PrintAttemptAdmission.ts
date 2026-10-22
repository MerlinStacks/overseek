import { randomUUID } from 'crypto';
import fs from 'fs';
import { z } from 'zod';
import { prisma } from '../../utils/prisma';
const conflict = () => Object.assign(new Error('Print attempt requires reconciliation'), { statusCode: 409 });
export function requirePrintProtocol(version: string | undefined, minimum?: string | null) { const parts = (value: string) => value.split('.').map(Number); if (!version || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) || Number(version.split('.')[0]) < 2 || minimum && (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(minimum) || parts(version).some((value, index, current) => value < parts(minimum)[index] && current.slice(0, index).every((previous, at) => previous === parts(minimum)[at])))) throw Object.assign(new Error('Print agent protocol version upgrade required'), { statusCode: 426 }); }
export function readBoundedLabelPdf(file: string, safe: (file: string) => boolean): Buffer {
    if (!safe(file)) throw conflict();
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size < 5 || stat.size > 10 * 1024 * 1024) throw conflict(); const bytes = fs.readFileSync(fd); if (bytes.length !== stat.size || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw conflict(); return bytes; } finally { fs.closeSync(fd); }
}
export async function claimPrintJobs(station: { id: string; accountId: string; defaultPrinterName?: string | null; name: string }, safe: (path: string) => boolean) {
    const jobs = await prisma.shippingPrintJob.findMany({ where: { accountId: station.accountId, printStationId: station.id, status: { in: ['queued', 'station_offline'] } }, orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }], take: 10, include: { label: true } });
    const admitted = [];
    for (const job of jobs) {
        const file = job.label.labelFilePath;
        if (!file || job.label.cancelledAt || !job.label.labelStoredUntil || job.label.labelStoredUntil <= new Date()) continue;
        try { readBoundedLabelPdf(file, safe); } catch { continue; }
        const claimId = randomUUID(), attempt = job.attempts + 1;
        const claimed = await prisma.$transaction(async tx => {
            const gate = `shipping-label-gate:${station.accountId}:${job.labelId}`;
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gate}, 0))`;
            const active = await tx.scopedOperation.findUnique({ where: { id: gate } });
            if (active && (active.result as any).state !== 'complete') return false;
            if (!await tx.shippingLabel.findFirst({ where: { id: job.labelId, accountId: station.accountId, updatedAt: job.label.updatedAt, cancelledAt: null, labelStoredUntil: { gt: new Date() } }, select: { id: true } })) return false;
            const changed = await tx.shippingPrintJob.updateMany({ where: { id: job.id, accountId: station.accountId, printStationId: station.id, status: job.status, attempts: job.attempts, updatedAt: job.updatedAt }, data: { status: 'picked_up', pickedUpAt: new Date(), attempts: attempt } });
            if (changed.count !== 1) return false;
            await tx.scopedOperation.create({ data: { id: `print-attempt:${job.id}:${attempt}`, accountId: station.accountId, kind: 'print-attempt', result: { claimId, stationId: station.id, jobId: job.id, attempt, state: 'claimed', labelVersion: job.label.updatedAt.toISOString() } } });
            return true;
        });
        if (claimed) admitted.push({ id: job.id, claimId, attempt, printerName: job.printerName || station.defaultPrinterName, labelFormat: job.label.labelFormat, labelDownloadPath: `/api/shipping/print-agent/jobs/${job.id}/label?claimId=${claimId}`, trackingNumber: job.label.trackingNumber, wooOrderId: job.label.wooOrderId });
    }
    return { printStation: { id: station.id, name: station.name }, jobs: admitted, recovery: 'Lost claim acknowledgements require reconciliation; never automatically reprint' };
}
export async function readClaimedJob(station: { id: string; accountId: string }, jobId: string, claimId: string) {
    z.string().uuid().parse(claimId);
    const job = await prisma.shippingPrintJob.findFirst({ where: { id: jobId, accountId: station.accountId, printStationId: station.id }, include: { label: true } });
    if (!job) throw Object.assign(new Error('Print job not found'), { statusCode: 404 });
    const receipt = await prisma.scopedOperation.findUnique({ where: { id: `print-attempt:${job.id}:${job.attempts}` } }), claim = receipt?.result as any;
    if (!receipt || receipt.accountId !== station.accountId || claim.claimId !== claimId || claim.stationId !== station.id || claim.jobId !== job.id || claim.attempt !== job.attempts) throw conflict();
    return { job, claim };
}
export async function reportClaimedJob(station: { id: string; accountId: string }, jobId: string, claimId: string, status: 'printed' | 'failed', errorMessage?: string) {
    z.enum(['printed', 'failed']).parse(status); z.string().max(2000).optional().parse(errorMessage);
    const { job, claim } = await readClaimedJob(station, jobId, claimId);
    if (claim.state === 'reported') { if (claim.status !== status || job.status !== status) throw conflict(); return { job, newlyReported: false }; }
    if (claim.state !== 'claimed') throw conflict();
    return prisma.$transaction(async tx => {
        const gate = `shipping-label-gate:${station.accountId}:${job.labelId}`;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gate}, 0))`;
        const active = await tx.scopedOperation.findUnique({ where: { id: gate } });
        if (active && (active.result as any).state !== 'complete') throw conflict();
        const changed = await tx.shippingPrintJob.updateMany({ where: { id: job.id, accountId: station.accountId, printStationId: station.id, status: 'picked_up', attempts: job.attempts, updatedAt: job.updatedAt }, data: { status, printedAt: status === 'printed' ? new Date() : null, errorMessage: status === 'failed' ? errorMessage || 'Agent reported failed; physical outcome requires review' : null } });
        if (changed.count !== 1) throw conflict();
        const updated = await tx.shippingLabel.updateMany({ where: { id: job.labelId, accountId: station.accountId, cancelledAt: null, updatedAt: new Date(claim.labelVersion) }, data: { status: status === 'printed' ? 'printed' : 'print_failed', ...(status === 'printed' ? { printedAt: new Date() } : {}), errorMessage: status === 'failed' ? errorMessage || 'Agent reported failed; reconcile before reprinting' : null } });
        if (updated.count !== 1) throw conflict();
        await tx.scopedOperation.update({ where: { id: `print-attempt:${job.id}:${job.attempts}` }, data: { result: { ...claim, state: 'reported', status, fulfillment: status === 'printed' ? 'not-confirmed' : 'not-requested' } } });
        return { job: { ...job, status }, newlyReported: true };
    });
}
