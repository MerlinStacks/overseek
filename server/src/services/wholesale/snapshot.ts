import { inferTierRanges, normalizeNotes } from './validation';

export interface WholesaleSnapshot {
    snapshotVersion: 1;
    account: { id: string; name: string; currency: string; timezone: string };
    catalog: Record<string, any>;
    branding: Record<string, any>;
    defaults: Record<string, any>;
    effectiveDate: string;
    validUntil: string;
    validityRevision?: number;
    categories: Array<{ key: string; label: string; products: any[] }>;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    AUD: '$', CAD: '$', HKD: '$', NZD: '$', SGD: '$', USD: '$',
    GBP: '£', EUR: '€', JPY: '¥', CNY: '¥', INR: '₹', KRW: '₩',
};

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function decimal(value: unknown, places = 4): string | null {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(places) : null;
}

function firstCategory(rawData: any, placement: any) {
    const category = Array.isArray(rawData?.categories)
        ? rawData.categories.find((item: unknown) => item && typeof item === 'object')
        : null;
    const label = text(placement.categoryLabel) || text(category?.name) || 'Products';
    const rawOrder = Number(placement.categorySortOrder ?? category?.menu_order ?? 0);
    return {
        key: String(placement.categoryKey ?? category?.slug ?? category?.id ?? label),
        label,
        sortOrder: Number.isInteger(rawOrder) && rawOrder >= 0 ? rawOrder : 0,
    };
}

const PDF_FONT_ALIASES: Record<string, string> = {
    'arial': 'Helvetica', 'helvetica': 'Helvetica', 'noto sans': 'Helvetica',
    'times': 'Times-Roman', 'times new roman': 'Times-Roman', 'georgia': 'Times-Roman',
    'courier': 'Courier', 'courier new': 'Courier',
};

export function safePdfFont(value: unknown, fallback = 'Helvetica') {
    return typeof value === 'string' ? PDF_FONT_ALIASES[value.trim().toLowerCase()] || fallback : fallback;
}

export function mergeBrandingSnapshot(branding: any, overrides: unknown) {
    const source = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides as Record<string, unknown> : {};
    const validated: Record<string, unknown> = {};
    if (typeof source.logoUrl === 'string') {
        try { const url = new URL(source.logoUrl); if (['http:', 'https:'].includes(url.protocol)) validated.logoUrl = source.logoUrl; } catch { /* Ignore legacy invalid overrides. */ }
    } else if (source.logoUrl === null) validated.logoUrl = null;
    for (const key of ['primaryColor', 'accentColor']) {
        if (source[key] === null || typeof source[key] === 'string' && /^#[0-9a-f]{6}$/i.test(source[key])) validated[key] = source[key];
    }
    for (const key of ['headingFont', 'bodyFont']) if (typeof source[key] === 'string' || source[key] === null) validated[key] = source[key];
    if (source.businessDetails && typeof source.businessDetails === 'object' && !Array.isArray(source.businessDetails)) validated.businessDetails = source.businessDetails;
    const merged = { ...branding, ...validated };
    return {
        ...merged,
        headingFont: safePdfFont(merged.headingFont, 'Helvetica'),
        bodyFont: safePdfFont(merged.bodyFont, 'Helvetica'),
    };
}

function variantSnapshot(variation: any) {
    const raw = variation.rawData && typeof variation.rawData === 'object' ? variation.rawData : {};
    const image = text(raw.image?.src)
        || (Array.isArray(variation.images) ? text(variation.images[0]?.src ?? variation.images[0]) : null);
    const options = Array.isArray(raw.attributes)
        ? raw.attributes.map((attribute: any) => ({ name: text(attribute?.name) || 'Option', option: text(attribute?.option) || '' }))
        : [];
    return { sku: text(variation.sku), imageUrl: image, options };
}

function currencySymbol(currency: string) {
    const code = currency.toUpperCase();
    return CURRENCY_SYMBOLS[code] || '¤';
}

function convertPrice(value: unknown, sourceBasis: unknown, includeTax: boolean, gstRate: number): number | null {
    if (value == null || value === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    const sourceIncludesTax = sourceBasis === 'INCLUSIVE';
    const multiplier = 1 + gstRate / 100;
    const converted = sourceIncludesTax === includeTax ? amount : includeTax ? amount * multiplier : amount / multiplier;
    return Math.round((converted + Number.EPSILON) * 100) / 100;
}

function displayMoney(symbol: string, value: number) {
    return `${symbol}${value.toFixed(2)}`;
}

export function normalizeWholesaleSnapshot(input: {
    account: any;
    catalog: any;
    branding: any;
    defaults: any;
    effectiveDate: Date;
    validUntil: Date;
}): WholesaleSnapshot {
    const grouped = new Map<string, { key: string; label: string; sortOrder: number; firstSeen: number; products: any[] }>();
    const currency = String(input.account.currency || 'USD').toUpperCase();
    const symbol = currencySymbol(currency);
    const gstRate = Number(input.defaults.gstRate ?? 0);
    const includeTax = !!input.catalog.pricesIncludeTax;
    const gstStatement = includeTax ? `Prices include ${gstRate}% GST` : `Prices exclude ${gstRate}% GST`;
    const placements = [...(input.catalog.products || [])].filter((placement: any) => !placement.isSuspended);

    for (const placement of placements) {
        const product = placement.product;
        const profile = product.wholesaleProfile;
        const category = firstCategory(product.rawData, placement);
        if (!grouped.has(category.key)) grouped.set(category.key, { ...category, firstSeen: grouped.size, products: [] });
        const tiers = [...(profile.priceTiers || [])].sort((a: any, b: any) => a.minimumQuantity - b.minimumQuantity);
        const ranges = inferTierRanges(tiers);
        const variantGroups = new Map<string, { imageUrl: string; labels: string[] }>();
        (product.variations || [])
            .map((variation: any, index: number) => ({ variation, index }))
            .sort((a: any, b: any) => {
                const aOrder = Number(a.variation.rawData?.menu_order);
                const bOrder = Number(b.variation.rawData?.menu_order);
                return (Number.isFinite(aOrder) ? aOrder : a.index) - (Number.isFinite(bOrder) ? bOrder : b.index) || a.index - b.index;
            })
            .map(({ variation }: any) => variation)
            .filter((variation: any) => variation.stockStatus === 'instock')
            .map(variantSnapshot)
            .filter((variation: any) => variation.imageUrl)
            .forEach((variation: any) => {
                const label = [variation.options.map((item: any) => `${item.name}: ${item.option}`).join(', '), variation.sku ? `SKU ${variation.sku}` : ''].filter(Boolean).join(' | ');
                const group = variantGroups.get(variation.imageUrl) || { imageUrl: variation.imageUrl, labels: [] };
                if (!group.labels.includes(label)) group.labels.push(label);
                variantGroups.set(variation.imageUrl, group);
            });
        const convertedRrp = convertPrice(product.rawData?.regular_price, input.defaults.priceTaxBasis, includeTax, gstRate);
        grouped.get(category.key)!.products.push({
            id: product.id,
            wooId: product.wooId,
            name: String(product.name || '').trim(),
            sku: String(product.sku || '').trim(),
            imageUrl: text(profile.imageUrl) || text(product.rawData?.images?.[0]?.src) || text(product.mainImage),
            ...(convertedRrp == null ? {} : { displayRrp: displayMoney(symbol, convertedRrp), rrpAmount: decimal(convertedRrp, 2) }),
            sourceRrp: text(product.rawData?.regular_price),
            stockFingerprint: `${product.stockStatus || ''}|${(product.variations || []).map((item: any) => item.stockStatus || '').sort().join(',')}`,
            notes: normalizeNotes(profile.notesDocument),
            personalisationTypes: [...(profile.personalisationTypes || [])].map(String).sort(),
            gstStatement,
            priceSetVersion: profile.priceSetVersion,
            tiers: tiers.map((tier: any, index: number) => ({
                minimumQuantity: tier.minimumQuantity,
                rangeLabel: ranges[index].rangeLabel,
                ...(tier.unitPrice == null ? {} : (() => {
                    const amount = convertPrice(tier.unitPrice, profile.priceTaxBasis, includeTax, gstRate)!;
                    const saving = convertedRrp == null ? null : Math.max(0, Math.round((convertedRrp - amount + Number.EPSILON) * 100) / 100);
                    return {
                        unitPriceAmount: decimal(amount, 2),
                        displayUnitPrice: displayMoney(symbol, amount),
                        ...(saving == null ? {} : { displaySaving: `Save ${displayMoney(symbol, saving)}/unit` }),
                    };
                })()),
                isPoa: !!tier.isPoa,
            })),
            variantGroups: [...variantGroups.values()],
        });
    }

    return {
        snapshotVersion: 1,
        account: {
            id: input.account.id,
            name: String(input.account.name || '').trim(),
            currency,
            timezone: String(input.account.timezone || 'UTC'),
        },
        catalog: {
            name: input.catalog.name,
            publicTitle: input.catalog.publicTitle,
            subtitle: input.catalog.subtitle,
            coverText: input.catalog.coverText,
            pricesIncludeTax: input.catalog.pricesIncludeTax,
            gstStatement,
            supplementaryPriceNotice: input.catalog.supplementaryPriceNotice,
            paymentCallout: input.catalog.paymentCallout,
            termsSections: input.catalog.termsSections,
            footerDetails: input.catalog.footerDetails,
            defaultsVersion: input.catalog.defaultsVersion,
        },
        branding: mergeBrandingSnapshot({
            logoUrl: input.branding.logoUrl,
            primaryColor: input.branding.primaryColor,
            accentColor: input.branding.accentColor,
            headingFont: input.branding.headingFont,
            bodyFont: input.branding.bodyFont,
            businessDetails: input.branding.businessDetails,
            reviewedAt: input.branding.reviewedAt?.toISOString?.() || input.branding.reviewedAt,
        }, input.catalog.brandingOverrides),
        defaults: {
            priceTaxBasis: input.defaults.priceTaxBasis,
            gstRate: decimal(input.defaults.gstRate),
            termsDocument: input.defaults.termsDocument,
            confidentialityNotice: input.defaults.confidentialityNotice,
            privacyNotice: input.defaults.privacyNotice,
            version: input.defaults.version,
            termsHash: input.defaults.termsHash,
            approvedAt: input.defaults.approvedAt?.toISOString?.() || input.defaults.approvedAt,
        },
        effectiveDate: input.effectiveDate.toISOString(),
        validUntil: input.validUntil.toISOString(),
        categories: [...grouped.values()]
            .sort((a, b) => a.sortOrder - b.sortOrder || a.firstSeen - b.firstSeen)
            .map(({ sortOrder, firstSeen, ...category }) => ({
                ...category,
                products: category.products.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
            })),
    };
}

export function snapshotProducts(snapshot: WholesaleSnapshot) {
    return snapshot.categories.flatMap(category => category.products);
}
