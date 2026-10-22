import { prisma } from '../utils/prisma';
import { checkInventoryHealth as checkHealth, sendLowStockAlerts as sendAlerts } from './InventoryHealthService';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stock = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
function scope(accountId: string, productId: string, variationId = 0) {
    if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 200 || typeof productId !== 'string' || !productId.trim() || productId.length > 200 || !Number.isSafeInteger(variationId) || variationId < 0 || variationId > 2147483647) throw new Error('Invalid stock scope');
}
export class InventoryService {
    static async getEffectiveStock(product: { stockQuantity: number | null; manageStock: boolean; rawData: unknown }): Promise<number | null> {
        if (product.manageStock !== true) return null;
        if (product.stockQuantity !== null && product.stockQuantity !== undefined) return stock(product.stockQuantity);
        const raw = object(product.rawData); return raw.manage_stock === true ? stock(raw.stock_quantity) : null;
    }
    /** Local independent buildability only. Missing/ambiguous/nested components are unavailable. */
    static async calculateBOMStock(accountId: string, productId: string, variationId = 0): Promise<number | null> {
        scope(accountId, productId, variationId);
        if (variationId > 0 && !await prisma.productVariation.findFirst({ where: { productId, wooId: variationId, product: { accountId } }, select: { id: true } })) return null;
        const bom = await prisma.bOM.findFirst({ where: { productId, variationId, product: { accountId } }, include: { items: { where: { isActive: true }, take: 201, include: {
            childProduct: { include: { boms: { select: { id: true }, take: 1 } } }, childVariation: true, internalProduct: true,
        } } } });
        if (!bom || !bom.items.length || bom.items.length > 200) return null;
        let capacity: number | null = null; const required = new Map<string, { units: number; available: number }>();
        for (const item of bom.items) {
            if (item.supplierItemId && !item.childProductId && !item.internalProductId) continue;
            if (Number(!!item.childProductId) + Number(!!item.internalProductId) !== 1 || item.supplierItemId) return null;
            const quantity = Number(item.quantity), waste = Number(item.wasteFactor);
            if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(waste) || waste < 0 || waste > 1) return null;
            let available: number | null, key: string;
            if (item.internalProductId) {
                if (!item.internalProduct || item.internalProduct.accountId !== accountId || item.childVariationId) return null;
                available = stock(item.internalProduct.stockQuantity); key = `internal:${item.internalProductId}`;
            } else {
                const child = item.childProduct;
                if (!child || child.accountId !== accountId || child.id === productId || child.status === 'trash' || child.boms.length) return null;
                if (item.childVariationId && (!item.childVariation || item.childVariation.productId !== child.id)) return null;
                const source = item.childVariationId ? item.childVariation! : child;
                if (object(source.rawData).status === 'trash') return null;
                available = await this.getEffectiveStock(source); key = `woo:${child.id}:${item.childVariationId || 0}`;
            }
            if (available === null) return null;
            const units = quantity * (1 + waste), previous = required.get(key);
            required.set(key, { units: units + (previous?.units || 0), available });
        }
        for (const component of required.values()) {
            if (!Number.isFinite(component.units) || component.units <= 0) return null;
            const buildable = Math.max(0, Math.floor(component.available / component.units));
            if (!Number.isSafeInteger(buildable)) return null;
            capacity = capacity === null ? buildable : Math.min(capacity, buildable);
        }
        return capacity;
    }
    static async getProductStock(accountId: string, productId: string) {
        scope(accountId, productId);
        const product = await prisma.wooProduct.findFirst({ where: { id: productId, accountId }, select: { stockQuantity: true, manageStock: true, rawData: true,
            variations: { orderBy: { wooId: 'asc' }, take: 101, select: { wooId: true, sku: true, stockQuantity: true, stockStatus: true, manageStock: true, rawData: true } },
            boms: { where: { product: { accountId } }, orderBy: { variationId: 'asc' }, take: 102, select: { id: true, variationId: true } },
        } });
        if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 });
        const raw = object(product.rawData), variable = raw.type === 'variable' || product.variations.length > 0;
        const parentBOM = product.boms.some(bom => bom.variationId === 0);
        if (!variable) {
            const quantity = parentBOM ? await this.calculateBOMStock(accountId, productId) : await this.getEffectiveStock(product);
            return { stockQuantity: quantity, isBOMBased: parentBOM, manageStock: parentBOM || product.manageStock === true, isVariable: false,
                coverage: { basis: parentBOM ? 'independent-local-BOM-buildability' : 'local-managed-stock', complete: quantity !== null, liveProviderVerified: false } };
        }
        const variants = [];
        for (const variation of product.variations.slice(0, 100)) {
            const bom = product.boms.some(b => b.variationId === variation.wooId), data = object(variation.rawData);
            const attributes = Array.isArray(data.attributes) ? data.attributes.slice(0, 20).flatMap(value => typeof object(value).option === 'string' ? [String(object(value).option).slice(0, 100)] : []).join(' / ') : '';
            variants.push({ wooId: variation.wooId, sku: variation.sku ?? undefined, stockQuantity: product.boms.length >= 102 ? null : bom ? await this.calculateBOMStock(accountId, productId, variation.wooId) : await this.getEffectiveStock(variation),
                stockStatus: variation.stockStatus ?? undefined, manageStock: bom || variation.manageStock === true, isBOMBased: bom, attributes });
        }
        const complete = product.variations.length <= 100 && product.boms.length < 102, hasBOM = variants.some(value => value.isBOMBased);
        const known = complete && !hasBOM && variants.length > 0 && variants.every(value => value.stockQuantity !== null);
        const total = known ? variants.reduce((sum, value) => sum + value.stockQuantity!, 0) : null;
        return { stockQuantity: total !== null && Number.isSafeInteger(total) ? total : null, isBOMBased: hasBOM, manageStock: variants.length > 0 && variants.every(value => value.manageStock), isVariable: true, variants,
            coverage: { complete: complete && variants.every(value => value.stockQuantity !== null) && !hasBOM, mappingComplete: complete, variantLimit: 100, liveProviderVerified: false, parentBOMIgnoredForVariants: parentBOM, aggregateBasis: hasBOM ? 'unavailable: variant BOM capacities can share components and cannot be summed' : 'sum-only-when-every-variant-is-known' } };
    }
    /** No costing implementation: unknown cost is not a known zero. */
    static async calculateCompositeCOGS(accountId: string, productId: string): Promise<null> { scope(accountId, productId); return null; }
    static checkInventoryHealth = checkHealth;
    static sendLowStockAlerts = sendAlerts;
}
