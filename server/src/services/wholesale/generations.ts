import fs from 'fs';
import { prisma } from '../../utils/prisma';
import { QueueFactory, QUEUES } from '../queue/QueueFactory';
import { AuditActions, AuditService } from '../AuditService';
import { syncAutomaticCatalogProducts, WholesaleConflictError } from './catalogs';
import { WholesaleNotFoundError, WholesaleValidationError } from './products';
import { getProductReadiness } from './validation';
import { normalizeWholesaleSnapshot, snapshotProducts } from './snapshot';
import { assertPrivateGenerationPath, generationPdfPath } from './storage';
import { reconcileEligibility } from './eligibility';

const ACTIVE_STATUSES = ['QUEUED', 'RENDERING'];

function publicGeneration(generation: any) {
    const { masterFilePath, basePagesPath, inputSnapshot, ...safe } = generation;
    return {
        ...safe,
        downloadable: !!masterFilePath && ['AWAITING_APPROVAL', 'APPROVED'].includes(generation.status),
        warning: generation.staleAt ? 'STALE' : generation.validUntil <= new Date() ? 'EXPIRED' : null,
    };
}

async function ensureNoActive(tx: any, accountId: string) {
    // Serialize generation requests per account; the status predicate cannot be represented by a schema constraint.
    // Advisory lock functions return PostgreSQL `void`. Prisma's query API tries
    // to deserialize that result and fails before the transaction can continue,
    // so execute the statement without requesting result rows.
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', accountId);
    const staleBefore = new Date(Date.now() - 35 * 60 * 1000);
    const abandoned = await tx.wholesaleCatalogGeneration.findMany({
        where: { accountId, status: 'RENDERING', startedAt: { lte: staleBefore } }, select: { id: true },
    });
    for (const generation of abandoned) {
        await fs.promises.rm(require('path').dirname(generationPdfPath(generation.id, true)), { recursive: true, force: true });
        await tx.wholesaleCatalogGeneration.updateMany({
            where: { id: generation.id, accountId, status: 'RENDERING', startedAt: { lte: staleBefore } },
            data: { status: 'FAILED', completedAt: new Date(), progressStage: 'FAILED', errorMessage: 'Generation lease expired', masterFilePath: null, basePagesPath: null },
        });
    }
    const active = await tx.wholesaleCatalogGeneration.findFirst({
        where: { accountId, status: { in: ACTIVE_STATUSES } }, select: { id: true },
    });
    if (active) throw new WholesaleConflictError('Another wholesale catalog generation is active for this account');
}

async function enqueue(generationId: string, accountId: string) {
    await QueueFactory.getQueue(QUEUES.WHOLESALE_CATALOG_GENERATE).add(
        'generate-wholesale-catalog', { generationId, accountId }, { jobId: `wholesale-catalog-${generationId}`, attempts: 1 },
    );
}

async function enqueueValidityUpdate(generationId: string, accountId: string, validUntil: Date, validityRevision: number) {
    await QueueFactory.getQueue(QUEUES.WHOLESALE_CATALOG_VALIDITY_UPDATE).add(
        'update-wholesale-catalog-validity',
        { generationId, accountId, validUntil: validUntil.toISOString(), validityRevision },
        { jobId: `wholesale-validity-${generationId}-${validityRevision}`, attempts: 1 },
    );
}

export class WholesaleGenerationService {
    static endOfDayInTimezone(value: string, timezone: string) {
        const [year, month, day] = value.split('-').map(Number);
        const next = new Date(Date.UTC(year, month - 1, day + 1));
        const target = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
        let instant = target;
        for (let attempt = 0; attempt < 3; attempt++) {
            const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
            const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
            instant += target - represented;
        }
        return new Date(instant - 1);
    }

    static validateValidUntil(value: string, now = new Date(), timezone = 'UTC') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WholesaleValidationError('validUntil must be an ISO date (YYYY-MM-DD)');
        let date: Date;
        try { date = this.endOfDayInTimezone(value, timezone); }
        catch { throw new WholesaleValidationError('Account timezone is invalid'); }
        if (Number.isNaN(date.getTime())) throw new WholesaleValidationError('validUntil is invalid');
        const [year, month, day] = value.split('-').map(Number);
        const calendarDate = new Date(Date.UTC(year, month - 1, day));
        if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
            throw new WholesaleValidationError('validUntil is invalid');
        }
        const maximumInstant = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const maximumDate = `${maximumInstant.getUTCFullYear()}-${String(maximumInstant.getUTCMonth() + 1).padStart(2, '0')}-${String(maximumInstant.getUTCDate()).padStart(2, '0')}`;
        const maximum = this.endOfDayInTimezone(maximumDate, timezone);
        if (date <= now) throw new WholesaleValidationError('validUntil must be in the future');
        if (date > maximum) throw new WholesaleValidationError('validUntil cannot be more than 30 days from now');
        return date;
    }

    static validateExtendedValidUntil(value: string, generation: { originalGeneratedAt?: Date | null; effectiveDate: Date }, now = new Date(), timezone = 'UTC') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WholesaleValidationError('validUntil must be an ISO date (YYYY-MM-DD)');
        let date: Date;
        try { date = this.endOfDayInTimezone(value, timezone); }
        catch { throw new WholesaleValidationError('Account timezone is invalid'); }
        if (Number.isNaN(date.getTime())) throw new WholesaleValidationError('validUntil is invalid');
        const [year, month, day] = value.split('-').map(Number);
        const calendarDate = new Date(Date.UTC(year, month - 1, day));
        if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) throw new WholesaleValidationError('validUntil is invalid');
        if (date <= now) throw new WholesaleValidationError('validUntil must be in the future');
        const anchor = new Date(generation.originalGeneratedAt || generation.effectiveDate);
        let anchorParts: Record<string, number>;
        try {
            anchorParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
                .formatToParts(anchor).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
        } catch { throw new WholesaleValidationError('Account timezone is invalid'); }
        const maximumCalendar = new Date(Date.UTC(anchorParts.year, anchorParts.month - 1, anchorParts.day + 30));
        const maximumValue = `${maximumCalendar.getUTCFullYear()}-${String(maximumCalendar.getUTCMonth() + 1).padStart(2, '0')}-${String(maximumCalendar.getUTCDate()).padStart(2, '0')}`;
        const maximum = this.endOfDayInTimezone(maximumValue, timezone);
        if (date > maximum) throw new WholesaleValidationError('validUntil cannot be more than 30 days from the original generation date');
        return date;
    }

    static async create(accountId: string, catalogId: string, userId: string, validUntilValue: string) {
        await reconcileEligibility(accountId);
        const effectiveDate = new Date();
        const generation = await (prisma as any).$transaction(async (tx: any) => {
            await ensureNoActive(tx, accountId);
            await syncAutomaticCatalogProducts(tx, accountId, catalogId);
            const account = await tx.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, currency: true, timezone: true } });
            const catalog = await tx.wholesaleCatalog.findFirst({
                where: { id: catalogId, accountId },
                include: {
                    products: {
                        include: {
                            product: {
                                include: {
                                    variations: { select: { sku: true, stockStatus: true, images: true, rawData: true } },
                                    wholesaleProfile: { include: { priceTiers: { orderBy: { sortOrder: 'asc' } } } },
                                },
                            },
                        },
                    },
                },
            });
            const defaults = await tx.wholesaleCatalogDefaults.findUnique({ where: { accountId } });
            const branding = await tx.wholesaleBrandProfile.findUnique({ where: { accountId } });
            const validUntil = this.validateValidUntil(validUntilValue, effectiveDate, account?.timezone || 'UTC');
            if (!catalog) throw new WholesaleNotFoundError('Catalog not found');
            if (catalog.status === 'ARCHIVED') throw new WholesaleConflictError('Archived catalogs cannot be generated');
            if (!defaults?.approvedAt || !defaults?.approvedById) throw new WholesaleValidationError('Approved wholesale defaults must be configured');
            if (!branding?.reviewedAt) throw new WholesaleValidationError('Approved wholesale branding must be configured');
            const catalogTerms = Array.isArray(catalog.termsSections) ? catalog.termsSections : [];
            if (!catalogTerms.length || catalogTerms.length > 12 || catalogTerms.some((term: any) => !String(term?.heading || '').trim() || !String(term?.content || '').trim())) {
                throw new WholesaleValidationError('Configure 1 to 12 structured wholesale terms');
            }
            const eligible = catalog.products.filter((placement: any) => !placement.isSuspended && getProductReadiness(placement.product).eligible);
            if (eligible.length !== catalog.products.filter((placement: any) => !placement.isSuspended).length) {
                throw new WholesaleValidationError('Every active catalog product must remain eligible');
            }
            if (eligible.length < 1 || eligible.length > 500) throw new WholesaleValidationError('Catalog must contain 1 to 500 active eligible products');
            const snapshot = normalizeWholesaleSnapshot({ account, catalog: { ...catalog, products: eligible }, defaults, branding, effectiveDate, validUntil });
            if (snapshotProducts(snapshot).some(product => !product.imageUrl)) throw new WholesaleValidationError('Every product requires a main image');
            return tx.wholesaleCatalogGeneration.create({ data: {
                accountId, catalogId, requestedById: userId, status: 'QUEUED', productCount: eligible.length,
                inputSnapshot: snapshot, effectiveDate, validUntil, progressStage: 'QUEUED', progressPercent: 0,
            } });
        }, { isolationLevel: 'Serializable' });
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_GENERATION_REQUESTED, 'WHOLESALE_CATALOG_GENERATION', generation.id, { catalogId, productCount: generation.productCount });
        try {
            await enqueue(generation.id, accountId);
        } catch (error) {
            await (prisma as any).wholesaleCatalogGeneration.update({ where: { id: generation.id }, data: { status: 'FAILED', errorMessage: 'Unable to enqueue generation' } });
            await AuditService.log(accountId, null, AuditActions.WHOLESALE_GENERATION_FAILED, 'WHOLESALE_CATALOG_GENERATION', generation.id, { failureType: 'QUEUE_ENQUEUE' });
            throw error;
        }
        return publicGeneration(generation);
    }

    static async list(accountId: string, catalogId?: string) {
        const generations = await (prisma as any).wholesaleCatalogGeneration.findMany({
            where: { accountId, ...(catalogId ? { catalogId } : {}) }, orderBy: { createdAt: 'desc' }, take: 100,
        });
        return generations.map(publicGeneration);
    }

    static async get(accountId: string, generationId: string) {
        const generation = await (prisma as any).wholesaleCatalogGeneration.findFirst({ where: { id: generationId, accountId } });
        if (!generation) throw new WholesaleNotFoundError('Generation not found');
        return generation;
    }

    static async getPublic(accountId: string, generationId: string) {
        return publicGeneration(await this.get(accountId, generationId));
    }

    static async cancel(accountId: string, generationId: string, userId: string) {
        const generation = await this.get(accountId, generationId);
        if (!ACTIVE_STATUSES.includes(generation.status)) throw new WholesaleConflictError('Only queued or rendering generations can be cancelled');
        const now = new Date();
        const updated = await (prisma as any).wholesaleCatalogGeneration.update({
            where: { id: generation.id },
            data: generation.status === 'QUEUED'
                ? { status: 'CANCELLED', cancelRequestedAt: now, completedAt: now, progressStage: 'CANCELLED' }
                : { cancelRequestedAt: now, progressStage: 'CANCELLING' },
        });
        if (generation.status === 'QUEUED') {
            const job = await QueueFactory.getQueue(QUEUES.WHOLESALE_CATALOG_GENERATE).getJob(`wholesale-catalog-${generation.id}`);
            try { await job?.remove(); } catch { /* The worker won the race and will observe cancelRequestedAt. */ }
            await AuditService.log(accountId, userId, AuditActions.WHOLESALE_GENERATION_CANCELLED, 'WHOLESALE_CATALOG_GENERATION', generation.id, {});
        }
        return publicGeneration(updated);
    }

    static async retry(accountId: string, generationId: string, userId: string) {
        const source = await this.get(accountId, generationId);
        if (ACTIVE_STATUSES.includes(source.status)) throw new WholesaleConflictError('An active generation cannot be retried');
        const generation = await (prisma as any).$transaction(async (tx: any) => {
            await ensureNoActive(tx, accountId);
            return tx.wholesaleCatalogGeneration.create({ data: {
                accountId, catalogId: source.catalogId, requestedById: userId, retryOfId: source.id,
                status: 'QUEUED', productCount: source.productCount, inputSnapshot: source.inputSnapshot,
                effectiveDate: source.effectiveDate, validUntil: source.validUntil, originalGeneratedAt: source.completedAt,
                progressStage: 'QUEUED', progressPercent: 0,
            } });
        }, { isolationLevel: 'Serializable' });
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_GENERATION_REQUESTED, 'WHOLESALE_CATALOG_GENERATION', generation.id, { retryOfId: source.id, exactSnapshot: true });
        try {
            await enqueue(generation.id, accountId);
        } catch (error) {
            await (prisma as any).wholesaleCatalogGeneration.update({ where: { id: generation.id }, data: { status: 'FAILED', errorMessage: 'Unable to enqueue generation' } });
            await AuditService.log(accountId, null, AuditActions.WHOLESALE_GENERATION_FAILED, 'WHOLESALE_CATALOG_GENERATION', generation.id, { failureType: 'QUEUE_ENQUEUE' });
            throw error;
        }
        return publicGeneration(generation);
    }

    static async approve(accountId: string, generationId: string, userId: string, note?: string) {
        const generation = await this.get(accountId, generationId);
        if (generation.status !== 'AWAITING_APPROVAL') throw new WholesaleConflictError('Generation is not awaiting approval');
        const updated = await (prisma as any).wholesaleCatalogGeneration.update({
            where: { id: generation.id }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), approvalNote: note || null },
        });
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_GENERATION_APPROVED, 'WHOLESALE_CATALOG_GENERATION', generation.id, { selfApproved: generation.requestedById === userId, hasNote: !!note });
        return publicGeneration(updated);
    }

    static async extendValidity(accountId: string, generationId: string, userId: string, validUntilValue: string) {
        const result = await (prisma as any).$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `wholesale-validity:${generationId}`);
            const generation = await tx.wholesaleCatalogGeneration.findFirst({
                where: { id: generationId, accountId }, include: { account: { select: { timezone: true } } },
            });
            if (!generation) throw new WholesaleNotFoundError('Generation not found');
            if (generation.status !== 'APPROVED') throw new WholesaleConflictError('Only approved generations can have validity extended');
            if (generation.staleAt) throw new WholesaleConflictError('Stale generations cannot have validity extended');
            if (generation.validityArtifactStatus === 'UPDATING') throw new WholesaleConflictError('A validity artifact update is already active');
            const validUntil = this.validateExtendedValidUntil(validUntilValue, generation, new Date(), generation.account?.timezone || 'UTC');
            const validityRevision = generation.validityRevision + 1;
            const claimed = await tx.wholesaleCatalogGeneration.updateMany({
                where: { id: generation.id, accountId, status: 'APPROVED', staleAt: null, validityArtifactStatus: { not: 'UPDATING' } },
                data: { validityArtifactStatus: 'UPDATING', errorMessage: null },
            });
            if (claimed.count !== 1) throw new WholesaleConflictError('Generation validity changed; retry the extension');
            return { generation, validUntil, validityRevision };
        }, { isolationLevel: 'Serializable' });
        try {
            await enqueueValidityUpdate(generationId, accountId, result.validUntil, result.validityRevision);
        } catch (error) {
            await (prisma as any).wholesaleCatalogGeneration.updateMany({
                where: { id: generationId, accountId, validityArtifactStatus: 'UPDATING', validityRevision: result.generation.validityRevision },
                data: { validityArtifactStatus: 'FAILED', errorMessage: 'Unable to enqueue validity artifact update' },
            });
            throw error;
        }
        await AuditService.log(accountId, userId, AuditActions.WHOLESALE_VALIDITY_EXTENSION_REQUESTED, 'WHOLESALE_CATALOG_GENERATION', generationId, {
            validUntil: result.validUntil, validityRevision: result.validityRevision,
        });
        return { ...publicGeneration({ ...result.generation, validityArtifactStatus: 'UPDATING' }), pendingValidUntil: result.validUntil };
    }

    static async readableFile(accountId: string, generationId: string) {
        const generation = await this.get(accountId, generationId);
        if (!['AWAITING_APPROVAL', 'APPROVED'].includes(generation.status) || !generation.masterFilePath) throw new WholesaleNotFoundError('Generated PDF is not available');
        const filePath = assertPrivateGenerationPath(generation.masterFilePath);
        try { await fs.promises.access(filePath, fs.constants.R_OK); } catch { throw new WholesaleNotFoundError('Generated PDF is not available'); }
        return { generation, filePath };
    }
}
