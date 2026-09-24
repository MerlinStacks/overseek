import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { stockDerivedBomItemSql } from './stockDerivedBom';

export const CUTOVER_PRODUCTS_PER_PAGE = 50;
export const CUTOVER_MAX_VARIATIONS = 1000;
export const CUTOVER_MAX_OWNERS = 1001;
export const CONTROL_MAX_BYTES = 64 * 1024;
export const CUTOVER_SOURCE_REBUILDS = 3;

export type CutoverProgress = { productsProcessed: number; ownerCertifications: number; pagesAcknowledged: number;
    lastPageProducts: number; lastPageOwners: number; sourceRebuilds: number; pageRebuilds: number; baselineEstablished: boolean; countsFromStart: boolean };
export type CutoverPage = { version: 1; after: string | null; productIds: string[]; sourceHash: string; productCount: number; ownerCount: number };
export type DeliveryControlCommand = { schemaVersion: number; revision: number; action: string; epoch: string | null; owners: number[];
    cursor?: string | null; settingsRevision?: number; page?: CutoverPage };
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function cutoverProgress(value: unknown, cursor?: string | null): CutoverProgress {
    const p = object(object(value).cutoverProgress);
    const number = (key: string) => Number.isSafeInteger(p[key]) && Number(p[key]) >= 0 ? Number(p[key]) : 0;
    return { productsProcessed: number('productsProcessed'), ownerCertifications: number('ownerCertifications'), pagesAcknowledged: number('pagesAcknowledged'),
        lastPageProducts: number('lastPageProducts'), lastPageOwners: number('lastPageOwners'), sourceRebuilds: number('sourceRebuilds'), pageRebuilds: number('pageRebuilds'),
        baselineEstablished: p.baselineEstablished === true || !!cursor, countsFromStart: p.countsFromStart === true || (!Object.keys(p).length && !cursor) };
}
export function controlBytes(command: DeliveryControlCommand) { return Buffer.byteLength(JSON.stringify(command), 'utf8'); }

// hasBom means stock-derived finished stock, matching inbound's filtered boms source.
type Header = { id: string; wooId: number; type: string | null; status: string | null; manageStock: boolean; rawManage: unknown; hasBom: boolean; variationCount: bigint | number };
type Variation = { productId: string; wooId: number; manageStock: boolean; rawManage: unknown };
type Mapping = { header: Header; variations: Variation[]; owners: number[] };
const error = (message: string): never => { throw new Error(`inventory_cutover_mapping_invalid: ${message}`); };

/** Ownership metadata only. No PO batches, supplier joins, projection rebuilds or full rawData blobs.
 * Parent rows use the existing (accountId,id) index; each variation count reads at
 * most 1001 indexed IDs. At most 50 parents and 1000 complete variation rows are materialized.
 */
async function mappings(tx: Prisma.TransactionClient, accountId: string, after: string | null, limit: number): Promise<Mapping[]> {
    const headers = await tx.$queryRaw<Header[]>(Prisma.sql`
        WITH page AS MATERIALIZED (
          SELECT p.id, p."wooId", p."manageStock", p."rawData"->>'type' AS type,
            p."rawData"->>'status' AS status, p."rawData"->'manage_stock' AS "rawManage"
          FROM "WooProduct" p WHERE p."accountId"=${accountId}
          ${after === null ? Prisma.empty : Prisma.sql`AND p.id > ${after}`}
          ORDER BY p.id LIMIT ${Math.min(CUTOVER_PRODUCTS_PER_PAGE, limit)}
         ) SELECT p.*, EXISTS(SELECT 1 FROM "BOM" b JOIN "BOMItem" bi ON bi."bomId"=b.id
             WHERE b."productId"=p.id AND ${stockDerivedBomItemSql}) AS "hasBom",
          (SELECT COUNT(*) FROM (SELECT v.id FROM "ProductVariation" v WHERE v."productId"=p.id AND v."deliveryActive" ORDER BY v."wooId" LIMIT 1001) bounded) AS "variationCount"
        FROM page p ORDER BY p.id`);
    const selected: Header[] = []; let variationRows = 0;
    for (const h of headers) {
        const count = Number(h.variationCount);
        if (count > CUTOVER_MAX_VARIATIONS) {
            if (selected.length) break;
            error(`product ${h.wooId} exceeds the 1000-variation protocol limit; no owners were truncated`);
        }
        if (variationRows + count > CUTOVER_MAX_VARIATIONS) break;
        selected.push({ ...h, variationCount: count }); variationRows += count;
    }
    const variations = variationRows ? await tx.$queryRaw<Variation[]>(Prisma.sql`
        SELECT v."productId", v."wooId", v."manageStock", v."rawData"->'manage_stock' AS "rawManage"
        FROM "ProductVariation" v JOIN "WooProduct" p ON p.id=v."productId"
        WHERE p."accountId"=${accountId} AND v."deliveryActive" AND v."productId" IN (${Prisma.join(selected.map(p => p.id))})
        ORDER BY v."productId", v."wooId" LIMIT 1001`) : [];
    if (variations.length > CUTOVER_MAX_VARIATIONS) error('variation mapping changed during its bounded read');
    return selected.map(header => {
        const children = variations.filter(v => v.productId === header.id);
        if (children.length !== Number(header.variationCount)) error(`incomplete variation mapping for ${header.wooId}`);
        const owners = new Set<number>();
        if (header.status !== 'trash' && !header.hasBom && ['simple', 'variable'].includes(header.type ?? '')) {
            if (!Number.isSafeInteger(header.wooId) || header.wooId <= 0) error(`invalid Woo owner for ${header.id}`);
            if (header.type === 'simple') {
                if (children.length) error(`simple product ${header.wooId} has variation rows`);
                owners.add(header.wooId);
            } else {
                const parentManaged = header.manageStock || header.rawManage === true;
                for (const child of children) {
                    if (!Number.isSafeInteger(child.wooId) || child.wooId <= 0 || child.wooId === header.wooId) error(`invalid variation owner for ${header.wooId}`);
                    if (![true, false, 'parent'].includes(child.rawManage as boolean | string)) continue; // Explicit unsupported input, not a guessed owner.
                    const inherited = child.rawManage === 'parent' || (!child.manageStock && child.rawManage !== true && parentManaged);
                    if (inherited && !parentManaged) continue;
                    owners.add(inherited ? header.wooId : child.wooId);
                }
            }
        }
        return { header, variations: children, owners: [...owners].sort((a, b) => a - b) };
    });
}
const sourceHash = (rows: Mapping[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

/** Caller holds Account in a bounded transaction. Only a complete prefix may move the cursor. */
export async function buildCutoverBatch(tx: Prisma.TransactionClient, accountId: string, revision: bigint, epoch: string | null, cursor: string | null,
    progress: CutoverProgress): Promise<DeliveryControlCommand> {
    const after = cursor === '~empty' ? null : cursor; // Historical empty-catalogue marker.
    const rows = await mappings(tx, accountId, after, CUTOVER_PRODUCTS_PER_PAGE);
    if (!rows.length && progress.baselineEstablished) return { schemaVersion: 1, revision: Number(revision), action: 'guarded', epoch, owners: [], cursor: after };
    let included: Mapping[] = []; let owners: number[] = [];
    let command: DeliveryControlCommand = { schemaVersion: 1, revision: Number(revision), action: 'baseline', epoch, owners, cursor: after,
        page: { version: 1, after, productIds: [], sourceHash: sourceHash([]), productCount: 0, ownerCount: 0 } };
    for (const row of rows) {
        const nextRows = [...included, row]; const nextOwners = [...new Set([...owners, ...row.owners])].sort((a, b) => a - b);
        const proposed: DeliveryControlCommand = { ...command, owners: nextOwners, cursor: row.header.id,
            page: { version: 1, after, productIds: nextRows.map(r => r.header.id), sourceHash: sourceHash(nextRows), productCount: nextRows.length, ownerCount: nextOwners.length } };
        if (nextOwners.length > CUTOVER_MAX_OWNERS || controlBytes(proposed) > CONTROL_MAX_BYTES) {
            if (!included.length) error(`complete product ${row.header.wooId} cannot fit the owner/control envelope bounds`);
            break;
        }
        included = nextRows; owners = nextOwners; command = proposed;
    }
    if (controlBytes(command) > CONTROL_MAX_BYTES) error('control envelope exceeds 64 KiB');
    return command;
}

/** Repeat the SAME bounded keyset prefix, not merely the old IDs: this also detects
 * insertions/deletions inside the in-flight page before its acknowledged cursor moves.
 */
export async function cutoverBatchStillCurrent(tx: Prisma.TransactionClient, accountId: string, page: CutoverPage) {
    try {
        const rows = await mappings(tx, accountId, page.after, Math.max(1, page.productCount));
        return rows.length === page.productCount && sourceHash(rows) === page.sourceHash;
    } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith('inventory_cutover_mapping_invalid:')) return false;
        throw cause;
    }
}
