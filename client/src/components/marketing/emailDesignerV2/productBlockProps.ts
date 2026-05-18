import type { ProductBlock } from '../../../lib/emailDesignerV2';

export interface EmailDesignerProduct {
    id: string;
    wooId?: number;
    name: string;
    price?: number | string;
    regularPrice?: number | string;
    mainImage?: string | null;
    images?: Array<{ src?: string }>;
    permalink?: string;
    short_description?: string;
    description?: string;
    rawData?: {
        permalink?: string;
        short_description?: string;
        description?: string;
        regular_price?: number | string;
    };
}

const stripTags = (value?: string) => (value || '').replace(/<[^>]*>/g, '').trim();

const getProductImage = (product: EmailDesignerProduct) => product.mainImage || product.images?.[0]?.src || '';
const getProductDescription = (product: EmailDesignerProduct) => stripTags(product.short_description || product.description || product.rawData?.short_description || product.rawData?.description);
const getProductUrl = (product: EmailDesignerProduct) => product.permalink || product.rawData?.permalink || '{{store_url}}';

export function productToBlockProps(product: EmailDesignerProduct): Partial<ProductBlock['props']> {
    const regularPrice = product.regularPrice ?? product.rawData?.regular_price;
    return {
        productId: product.id,
        productWooId: product.wooId,
        productName: product.name,
        productImage: getProductImage(product),
        productPrice: product.price !== undefined && product.price !== null ? String(product.price) : '',
        productRegularPrice: regularPrice !== undefined && regularPrice !== null ? String(regularPrice) : '',
        productDescription: getProductDescription(product),
        productUrl: getProductUrl(product),
        buttonHref: getProductUrl(product),
    };
}

export function getProductImagePreview(product: EmailDesignerProduct): string {
    return getProductImage(product);
}
