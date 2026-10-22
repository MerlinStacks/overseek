import { randomUUID, createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { WooService } from './woo';
import { calculateContentSeoScore } from '@overseek/core';
export const contentFields = z.object({ title: z.string().trim().min(1).max(500), content: z.string().max(500000), excerpt: z.string().max(20000), focusKeyword: z.string().max(200), status: z.enum(['draft', 'publish', 'private', 'pending']) }).strict();
const conflict = () => Object.assign(new Error('Content operation requires reconciliation'), { statusCode: 409 });
function remoteDate(value: unknown): Date { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw conflict(); const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`); if (!Number.isFinite(date.getTime())) throw conflict(); return date; }
/** Legacy required DB date columns may hold an observation time for undated drafts.
 * Never expose those values as observed provider creation/modification dates. */
export function presentContent(row: any) {
    const { rawData, ...item } = row;
    const basis = rawData?._overseekContentObservation;
    return { ...item, ...(basis?.modifiedKnown === false ? { dateModified: null } : {}), ...(basis?.createdKnown === false ? { dateCreated: null } : {}), dateBasis: basis ? 'provider dates only where supplied; missing draft dates remain null' : 'legacy synced provider date fields' };
}
export async function writeContent(accountId: string, actorId: string, kind: 'pages' | 'posts', resourceId: string | null, input: unknown) {
    const body = z.object({ operationId: z.string().uuid(), version: z.string().datetime().nullable(), fields: contentFields }).strict().parse(input);
    if (resourceId === null && body.version !== null || resourceId !== null && body.version === null) throw conflict();
    const operationId = `content-operation:${accountId}:${body.operationId}`, gateId = `content-gate:${accountId}:${kind}:${resourceId || `create:${actorId}`}`, digest = createHash('sha256').update(JSON.stringify([actorId, kind, resourceId, body])).digest('hex');
    const admitted = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${gateId}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id: operationId } });
        if (receipt) { const value = receipt.result as any; if (value.digest !== digest || value.state !== 'complete') throw conflict(); return { replay: true as const, item: value.item }; }
        const gate = await tx.scopedOperation.findUnique({ where: { id: gateId } }); if (gate && (gate.result as any).state !== 'complete') throw conflict();
        const model = kind === 'pages' ? tx.wooPage : tx.wooBlogPost as unknown as typeof tx.wooPage;
        const current = resourceId ? await model.findFirst({ where: { id: resourceId, accountId } }) : null;
        if (resourceId && (!current || current.updatedAt.toISOString() !== body.version)) throw conflict();
        const reservedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() || 0) + 1));
        if (current) { const changed = await model.updateMany({ where: { id: current.id, accountId, updatedAt: current.updatedAt }, data: { updatedAt: reservedAt } }); if (changed.count !== 1) throw conflict(); }
        await tx.scopedOperation.create({ data: { id: operationId, accountId, kind: 'content-write', result: { digest, state: 'pending', resourceId, kind, operationId: body.operationId } } });
        await tx.scopedOperation.upsert({ where: { id: gateId }, create: { id: gateId, accountId, kind: 'content-write-gate', result: { state: 'pending', operationId: body.operationId } }, update: { result: { state: 'pending', operationId: body.operationId } } });
        return { replay: false as const, current, reservedAt };
    });
    if (admitted.replay) return admitted.item;
    try {
        const woo = await WooService.forAccount(accountId), { focusKeyword, ...fields } = body.fields;
        const response = resourceId ? kind === 'pages' ? await woo.updatePage(admitted.current!.wooId, fields, actorId) : await woo.updatePost(admitted.current!.wooId, fields, actorId) : kind === 'pages' ? await woo.createPage(fields, actorId) : await woo.createPost(fields, actorId);
        const remote = z.object({ id: z.number().int().positive().safe(), title: z.object({ rendered: z.string().max(10000) }), content: z.object({ rendered: z.string().max(1000000) }), excerpt: z.object({ rendered: z.string().max(50000) }), status: z.enum(['draft', 'publish', 'private', 'pending']), slug: z.string().max(500), link: z.string().max(2048).url(), date_gmt: z.string().nullish(), modified_gmt: z.string().nullish() }).parse(response);
        if (admitted.current && remote.id !== admitted.current.wooId) throw conflict();
        const seo = calculateContentSeoScore({ title: remote.title.rendered, content: remote.content.rendered, excerpt: remote.excerpt.rendered, focusKeyword, slug: remote.slug, permalink: remote.link });
        const item = await prisma.$transaction(async tx => {
            const model = kind === 'pages' ? tx.wooPage : tx.wooBlogPost as unknown as typeof tx.wooPage;
            const observedAt = new Date();
            const data = { title: remote.title.rendered, content: remote.content.rendered, excerpt: remote.excerpt.rendered, status: remote.status, slug: remote.slug, permalink: remote.link, dateModified: remote.modified_gmt ? remoteDate(remote.modified_gmt) : observedAt, seoScore: seo.score, seoData: { focusKeyword, analysis: seo.tests } as any, rawData: { ...response, _overseekContentObservation: { modifiedKnown: !!remote.modified_gmt, createdKnown: !!remote.date_gmt, observedAt: observedAt.toISOString() } } as any, updatedAt: new Date(Math.max(Date.now(), admitted.reservedAt.getTime() + 1)) };
            let saved;
            if (admitted.current) { const changed = await model.updateMany({ where: { id: admitted.current.id, accountId, updatedAt: admitted.reservedAt }, data }); if (changed.count !== 1) throw conflict(); saved = await model.findFirst({ where: { id: admitted.current.id, accountId } }); }
            else { if (await model.findFirst({ where: { accountId, wooId: remote.id } })) throw conflict(); saved = await model.create({ data: { ...data, id: randomUUID(), accountId, wooId: remote.id, dateCreated: remote.date_gmt ? remoteDate(remote.date_gmt) : observedAt } }); }
            if (!saved) throw conflict();
            await tx.scopedOperation.update({ where: { id: operationId }, data: { result: { digest, state: 'complete', item: JSON.parse(JSON.stringify(presentContent(saved))) } } });
            await tx.scopedOperation.update({ where: { id: gateId }, data: { result: { state: 'complete', operationId: body.operationId } } });
            return presentContent(saved);
        });
        return item;
    } catch { await prisma.scopedOperation.updateMany({ where: { id: operationId }, data: { result: { digest, state: 'uncertain', resourceId, kind, operationId: body.operationId } } }).catch(() => undefined); throw conflict(); }
}
