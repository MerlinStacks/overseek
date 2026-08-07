import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { AuditActions, AuditService } from '../AuditService';
import { renderWholesaleCatalog } from './renderer';
import { WholesaleSnapshot } from './snapshot';
import { shareArtifactPaths } from './storage';

const MAX_RASTER_PAGES = 500;
const MAX_RASTER_PAGE_BYTES = 15 * 1024 * 1024;
const MAX_RASTER_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_THUMBNAIL_TOTAL_BYTES = 50 * 1024 * 1024;

async function rasterOutput(output: string, maxFileBytes: number, maxTotalBytes: number) {
    const files = (await fs.promises.readdir(output)).filter(file => /^page-\d+\.png$/.test(file)).sort((a, b) => Number(a.slice(5, -4)) - Number(b.slice(5, -4)));
    if (!files.length || files.length > MAX_RASTER_PAGES) throw new Error('PDF rasterization produced an invalid page count');
    const pages = files.map(file => Number(file.slice(5, -4)));
    if (new Set(pages).size !== pages.length || pages.some((page, index) => page !== index + 1)) throw new Error('PDF rasterization produced an invalid page set');
    let total = 0;
    for (const file of files) {
        const stat = await fs.promises.stat(path.join(output, file));
        if (!stat.isFile() || !stat.size || stat.size > maxFileBytes) throw new Error('PDF rasterization page exceeds size limit');
        total += stat.size;
        if (total > maxTotalBytes) throw new Error('PDF rasterization output exceeds size limit');
    }
    return pages;
}

function runRasterizer(pdf: string, output: string, args: string[], deadline: number, maxFileBytes: number, maxTotalBytes: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
        const child = spawn('pdftoppm', [...args, pdf, path.join(output, 'page')], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        let error = '';
        let settled = false;
        const fail = (cause: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fs.promises.rm(output, { recursive: true, force: true }).finally(() => reject(cause));
        };
        const timeout = Math.max(1, deadline - Date.now());
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            fail(new Error('PDF rasterization timed out'));
        }, timeout);
        child.stderr.on('data', chunk => { error = `${error}${chunk}`.slice(-2000); });
        child.on('error', cause => fail(new Error(`PDF rasterization unavailable: ${cause.message}`)));
        child.on('close', async code => {
            if (settled) return;
            if (code !== 0) return fail(new Error(`PDF rasterization failed (${code}): ${error}`));
            try {
                const pages = await rasterOutput(output, maxFileBytes, maxTotalBytes);
                settled = true;
                clearTimeout(timer);
                resolve(pages);
            } catch (cause: any) { fail(cause); }
        });
    });
}

export async function rasterizePdf(pdf: string, pages: string, thumbnails: string, deadline = Date.now() + 10 * 60 * 1000, expectedPages?: number): Promise<{ pageCount: number }> {
    await Promise.all([pages, thumbnails].map(output => fs.promises.mkdir(output, { recursive: true })));
    const fullPages = await runRasterizer(pdf, pages, ['-png', '-r', '150'], deadline, MAX_RASTER_PAGE_BYTES, MAX_RASTER_TOTAL_BYTES);
    if (expectedPages != null && fullPages.length !== expectedPages) throw new Error('PDF rasterization produced an invalid page count');
    const thumbnailPages = await runRasterizer(pdf, thumbnails, ['-png', '-scale-to-x', '280', '-scale-to-y', '-1'], deadline, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_TOTAL_BYTES);
    if (thumbnailPages.length !== fullPages.length || thumbnailPages.some((page, index) => page !== fullPages[index])) throw new Error('PDF thumbnail rasterization does not match full pages');
    return { pageCount: fullPages.length };
}

function filenamePart(value: string) {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'Customer';
}

export class WholesaleCatalogShareWorker {
    static async process(job: any) {
        const { shareId, accountId } = job.data;
        const share = await (prisma as any).wholesaleCatalogShare.findFirst({ where: { id: shareId, accountId }, include: { generation: true, catalog: true } });
        if (!share || share.artifactStatus === 'READY') return;
        if (!['QUEUED', 'RENDERING', 'FAILED'].includes(share.artifactStatus)) return;
        const temporary = shareArtifactPaths(share.id, true);
        const final = shareArtifactPaths(share.id);
        const backup = `${final.directory}.old`;
        try {
            await fs.promises.rm(temporary.directory, { recursive: true, force: true });
            await Promise.all([temporary.pages, temporary.thumbnails].map(directory => fs.promises.mkdir(directory, { recursive: true })));
            await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: { artifactStatus: 'RENDERING', artifactError: null } });
            const customer = share.customerSnapshot as any;
            const deadline = Date.now() + 30 * 60 * 1000;
            const result = await renderWholesaleCatalog(share.generation.inputSnapshot as WholesaleSnapshot, temporary.pdf, { deadline, checkCancelled: async () => {}, personalization: { company: customer.company, contact: customer.contact, confidentialityText: share.confidentialityTextSnapshot } });
            const raster = await rasterizePdf(temporary.pdf, temporary.pages, temporary.thumbnails, deadline, result.pageCount);
            await fs.promises.mkdir(path.dirname(final.directory), { recursive: true });
            await fs.promises.rm(backup, { recursive: true, force: true });
            let hadPrevious = false;
            try { await fs.promises.rename(final.directory, backup); hadPrevious = true; } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
            try { await fs.promises.rename(temporary.directory, final.directory); }
            catch (error) {
                if (hadPrevious) await fs.promises.rename(backup, final.directory).catch(() => {});
                throw error;
            }
            await fs.promises.rm(backup, { recursive: true, force: true });
            const date = new Date(share.generation.effectiveDate).toISOString().slice(0, 10);
            const fileName = `${filenamePart(customer.company)}-${filenamePart(share.catalog.publicTitle)}-${date}-v${share.generation.versionNumber}.pdf`;
            await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: { artifactStatus: 'READY', personalizedPdfPath: final.pdf, personalizedPagesPath: final.pages, personalizedFileName: fileName, customerSnapshot: { ...customer, pageCount: raster.pageCount } } });
            await AuditService.log(accountId, null, AuditActions.WHOLESALE_SHARE_PREPARED, 'WHOLESALE_CATALOG_SHARE', share.id, { pageCount: raster.pageCount });
        } catch (error: any) {
            await fs.promises.rm(temporary.directory, { recursive: true, force: true }).catch(() => {});
            const message = String(error?.message || 'Share preparation failed').slice(0, 1000);
            await (prisma as any).wholesaleCatalogShare.update({ where: { id: share.id }, data: { artifactStatus: 'FAILED', artifactError: message, personalizedPdfPath: null, personalizedPagesPath: null } });
            await AuditService.log(accountId, null, AuditActions.WHOLESALE_SHARE_FAILED, 'WHOLESALE_CATALOG_SHARE', share.id, { error: message });
            Logger.error('[WholesaleShareWorker] Preparation failed', { shareId, error: message });
            throw error;
        }
    }
}
