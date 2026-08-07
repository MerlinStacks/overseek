export type WholesaleTaxImportSource = 'WOOCOMMERCE_SETTINGS' | 'WOOCOMMERCE_TAX_RATES' | 'ACCOUNT_REVENUE_TAX_SETTING' | 'DEFAULT_GST_RATE';

export interface WholesaleTaxImportCandidate {
    priceTaxBasis: 'INCLUSIVE' | 'EXCLUSIVE';
    gstRate: string;
    source: {
        priceTaxBasis: WholesaleTaxImportSource;
        gstRate: WholesaleTaxImportSource;
    };
    warnings: string[];
}

export function buildWholesaleTaxImportCandidate(input: {
    wooSettings?: unknown;
    wooTaxRates?: unknown;
    accountRevenueTaxInclusive: boolean;
    warnings?: string[];
}): WholesaleTaxImportCandidate {
    const warnings = [...(input.warnings || [])];
    const settings = Array.isArray(input.wooSettings) ? input.wooSettings : [];
    const includeTax = settings.find((setting: any) => setting?.id === 'woocommerce_prices_include_tax')?.value;
    const hasWooBasis = includeTax === 'yes' || includeTax === 'no';

    if (!hasWooBasis) warnings.push('WooCommerce did not return a usable prices-include-tax setting; the account revenue tax setting is shown instead.');

    const rates = (Array.isArray(input.wooTaxRates) ? input.wooTaxRates : [])
        .map((rate: any, index) => {
            const rawRate = rate?.rate;
            const isDecimal = (typeof rawRate === 'number' && Number.isFinite(rawRate))
                || (typeof rawRate === 'string' && /^\d+(?:\.\d+)?$/.test(rawRate.trim()));
            return {
                index,
                name: String(rate?.name || ''),
                taxClass: String(rate?.class || '').toLowerCase(),
                value: isDecimal ? Number(rawRate) : Number.NaN,
            };
        })
        .filter(rate => Number.isFinite(rate.value) && rate.value >= 0 && rate.value <= 100)
        .sort((left, right) => {
            const score = (rate: typeof left) => (/\bgst\b/i.test(rate.name) ? 2 : rate.taxClass === 'standard' || rate.taxClass === '' ? 1 : 0);
            return score(right) - score(left) || left.index - right.index;
        });
    const selectedRate = rates[0];

    if (!selectedRate) warnings.push('WooCommerce did not return a usable standard or GST tax rate; the 10% fallback is shown instead.');

    return {
        priceTaxBasis: hasWooBasis ? (includeTax === 'yes' ? 'INCLUSIVE' : 'EXCLUSIVE') : (input.accountRevenueTaxInclusive ? 'INCLUSIVE' : 'EXCLUSIVE'),
        gstRate: selectedRate ? String(Number(selectedRate.value.toFixed(4))) : '10',
        source: {
            priceTaxBasis: hasWooBasis ? 'WOOCOMMERCE_SETTINGS' : 'ACCOUNT_REVENUE_TAX_SETTING',
            gstRate: selectedRate ? 'WOOCOMMERCE_TAX_RATES' : 'DEFAULT_GST_RATE',
        },
        warnings,
    };
}
