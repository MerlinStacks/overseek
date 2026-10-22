import type { ProductBlock } from '../../../lib/emailDesignerV2';
export interface EmailDesignerProduct { id: string; wooId?: number; name: string; price?: number | string; regularPrice?: number | string; mainImage?: string | null; images?: Array<{ src?: string }>; permalink?: string; short_description?: string; description?: string; rawData?: { permalink?: string; short_description?: string; description?: string; regular_price?: number | string } }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : '';
function url(value: unknown) { const raw = text(value, 2048); if (!raw) return ''; try { const parsed = new URL(raw); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; } }
function amount(value: unknown) { if (typeof value !== 'string' && typeof value !== 'number') return ''; const raw = String(value).trim(); return /^\d+(?:\.\d{1,6})?$/.test(raw) && Number.isFinite(Number(raw)) && Number(raw) <= 1e12 ? raw : ''; }
function description(value: unknown) { const raw = text(value, 20000); if (!raw) return ''; const template = document.createElement('template'); template.innerHTML = raw; template.content.querySelectorAll('script,style,noscript').forEach(node => node.remove()); return (template.content.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000); }
/** No invented product destination/currency/discount; callers must expose unavailable fields. */
export function convertProductToBlock(value: unknown): { props: Partial<ProductBlock['props']>; unavailable: string[] } {
    const product = record(value), raw = record(product.rawData);
    if (!text(product.id, 200) || !text(product.name, 500) || product.wooId !== undefined && (typeof product.wooId !== 'number' || !Number.isSafeInteger(product.wooId) || product.wooId <= 0)) throw new Error('Product identity/name unavailable');
    const image = url(product.mainImage) || (Array.isArray(product.images) ? url(record(product.images[0]).src) : ''), destination = url(product.permalink) || url(raw.permalink), price = amount(product.price), regular = amount(product.regularPrice ?? raw.regular_price);
    const regularPrice = regular && price && Number(regular) >= Number(price) ? regular : '';
    const body = description(product.short_description) || description(product.description) || description(raw.short_description) || description(raw.description);
    const unavailable = [...(!destination ? ['Product destination unavailable (no homepage fallback)'] : []), ...(!image ? ['Product image unavailable'] : []), ...(!price ? ['Source price unavailable'] : []), ...(regular && !regularPrice ? ['Regular/sale price relationship unavailable'] : []), 'Source currency and historical price provenance are not established by this conversion'];
    return { props: { productId: product.id as string, productWooId: product.wooId as number | undefined, productName: text(product.name, 500), productImage: image, productPrice: price, productRegularPrice: regularPrice, productDescription: body, productUrl: destination, buttonHref: destination }, unavailable };
}
export function productToBlockProps(product: EmailDesignerProduct): Partial<ProductBlock['props']> { return convertProductToBlock(product).props; }
export function getProductImagePreview(product: EmailDesignerProduct): string { try { return convertProductToBlock(product).props.productImage || ''; } catch { return ''; } }
