import type { WholesaleBranding, WholesaleCatalog, WholesaleDefaults, WholesaleProductSummary } from '../../types/wholesaleCatalog';

export type CatalogPreviewPage =
    | { kind: 'cover'; title: string; subtitle: string | null; coverText: string | null }
    | { kind: 'products'; category: string; continued: boolean; products: WholesaleProductSummary[] }
    | { kind: 'terms'; sections: WholesaleCatalog['termsSections']; paymentCallout: WholesaleCatalog['paymentCallout']; footerDetails: WholesaleCatalog['footerDetails'] };

export interface CatalogPreviewModel {
    pages: CatalogPreviewPage[];
    branding: WholesaleBranding;
    defaults: WholesaleDefaults;
    pricesIncludeTax: boolean;
    priceNotice: string | null;
}

export function buildCatalogPreview(
    catalog: WholesaleCatalog,
    products: WholesaleProductSummary[],
    defaults: WholesaleDefaults,
    branding: WholesaleBranding,
): CatalogPreviewModel {
    const groups = new Map<string, WholesaleProductSummary[]>();
    for (const product of products) {
        const category = product.categoryLabel?.trim() || 'Products';
        groups.set(category, [...(groups.get(category) || []), product]);
    }
    const productPages: CatalogPreviewPage[] = [];
    for (const [category, categoryProducts] of groups) {
        const sorted = [...categoryProducts].sort((a, b) => a.name.localeCompare(b.name));
        for (let index = 0; index < sorted.length; index += 8) {
            productPages.push({ kind: 'products', category, continued: index > 0, products: sorted.slice(index, index + 8) });
        }
    }
    return {
        pages: [
            { kind: 'cover', title: catalog.publicTitle, subtitle: catalog.subtitle, coverText: catalog.coverText },
            ...productPages,
            { kind: 'terms', sections: catalog.termsSections, paymentCallout: catalog.paymentCallout, footerDetails: catalog.footerDetails },
        ],
        branding,
        defaults,
        pricesIncludeTax: catalog.pricesIncludeTax,
        priceNotice: catalog.supplementaryPriceNotice,
    };
}
