import { prisma } from '../utils/prisma';
import { WooService } from './woo';
import { z } from 'zod';
import { scopeId } from './BoundedProviderWork';
const stock = z.number().finite().min(-1000000000).max(1000000000);
export interface StockValidationResult {
    valid: boolean; state: 'matched' | 'mismatched' | 'unmanaged' | 'unavailable';
    wooStock: number | null; expectedStock: number; diff: number | null;
    productName?: string; observedAt: string | null; authorizesWrite: false;
}
/** A fresh observation only; never a provider compare-and-swap authorization. */
export class StockValidationService {
    static async validateBeforeWrite(accountId: string, wooProductId: number, expectedCurrentStock: number, variationId?: number): Promise<StockValidationResult> {
        scopeId.parse(accountId); z.number().int().positive().safe().parse(wooProductId); stock.parse(expectedCurrentStock);
        if (variationId !== undefined) z.number().int().positive().safe().parse(variationId);
        const unavailable: StockValidationResult = { valid: false, state: 'unavailable', wooStock: null, expectedStock: expectedCurrentStock, diff: null, observedAt: null, authorizesWrite: false };
        try {
            const woo = await WooService.forAccount(accountId);
            const raw = variationId === undefined ? await woo.getProduct(wooProductId, { bypassCache: true }) : await woo.getProductVariation(wooProductId, variationId);
            const parsed = z.object({ id: z.number().int().positive(), name: z.string().max(500).optional(), manage_stock: z.boolean(), stock_quantity: stock.nullable() }).safeParse(raw);
            if (!parsed.success || parsed.data.id !== (variationId ?? wooProductId)) return unavailable;
            const row = parsed.data, observedAt = new Date().toISOString();
            if (!row.manage_stock) return { ...unavailable, state: 'unmanaged', productName: row.name, observedAt };
            if (row.stock_quantity === null) return unavailable;
            const diff = row.stock_quantity - expectedCurrentStock;
            return { ...unavailable, valid: diff === 0, state: diff === 0 ? 'matched' : 'mismatched', wooStock: row.stock_quantity, diff, productName: row.name, observedAt };
        } catch { return unavailable; }
    }
    static async notifyMismatch(_accountId: string, _productId: number, _productName: string, _wooStock: number, _expectedStock: number, _newStock: number): Promise<never> {
        throw new Error('Unadmitted mismatch override notifications disabled; a permissioned stock-write receipt is required');
    }
    static async logStockChange(accountId: string, productId: string, source: 'USER' | 'SYSTEM_BOM' | 'SYSTEM_SYNC', previousStock: number | null, newStock: number, validationStatus: 'PASSED' | 'SKIPPED' | 'MISMATCH_OVERRIDE', additionalDetails?: Record<string, unknown>, actorId?: string): Promise<void> {
        scopeId.parse(accountId); scopeId.parse(productId); stock.nullable().parse(previousStock); stock.parse(newStock);
        if (source === 'USER' || validationStatus === 'MISMATCH_OVERRIDE') throw new Error('User/override audit requires a permissioned stock-write receipt; this system audit cannot authorize it');
        z.enum(['SYSTEM_BOM', 'SYSTEM_SYNC']).parse(source); z.enum(['PASSED', 'SKIPPED']).parse(validationStatus);
        const details = z.record(z.string(), z.unknown()).optional().parse(additionalDetails);
        if (JSON.stringify(details ?? {}).length > 50000) throw new Error('Oversize audit details');
        const product = await prisma.wooProduct.findFirst({ where: { accountId, id: productId }, select: { id: true, updatedAt: true } });
        if (!product) throw new Error('Scoped audit product unavailable');
        if (actorId) throw new Error('System audit cannot attribute a user without a permissioned write receipt');
        await prisma.auditLog.create({ data: { accountId, userId: null, action: 'UPDATE', resource: 'PRODUCT', resourceId: productId, source, previousValue: previousStock === null ? undefined : { stock_quantity: previousStock }, validationStatus, details: { ...details, stock_quantity: newStock, auditProductVersion: product.updatedAt?.toISOString() ?? null, providerWriteVersion: null, observationOnly: true, authorizesWrite: false } as any } });
    }
}
