type Raw = Record<string, any>;

const rawRecord = (value: unknown): Raw | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Raw : null;

export const VARIANT_FIELDS = ['color', 'size', 'material', 'pattern', 'age_group', 'gender', 'size_type', 'size_system'] as const;

export function variantAttributeField(attribute: unknown): string | null {
    const record = rawRecord(attribute);
    if (!record) return null;
    const aliases: Record<string, string> = { colour: 'color', agegroup: 'age_group', sizetype: 'size_type', sizesystem: 'size_system' };
    for (const value of [record.slug, record.name]) {
        const key = String(value || '').toLowerCase().replace(/^attribute_/, '').replace(/^pa_/, '').replace(/[\s-]+/g, '_');
        const field = aliases[key] || key;
        if ((VARIANT_FIELDS as readonly string[]).includes(field)) return field;
    }
    return null;
}

export function platformVariantValue(field: string, value: string | null, channel?: string): string | null {
    if (!value) return value;
    const lower = value.trim().toLowerCase();
    if (field === 'gender' && ['male', 'female', 'unisex'].includes(lower)) return lower;
    if (field === 'age_group' && ['newborn', 'infant', 'toddler', 'kids', 'adult', ...(channel === 'meta' ? ['teen', 'all ages'] : [])].includes(lower)) return lower;
    if (field === 'size_type' && ['regular', 'petite', 'plus', 'tall', 'big', 'maternity'].includes(lower)) return lower;
    if (field === 'size_system' && ['US', 'UK', 'EU', 'DE', 'FR', 'JP', 'CN', 'IT', 'BR', 'MEX', 'AU'].includes(value.trim().toUpperCase())) return value.trim().toUpperCase();
    return value; // Unknown values are diagnosed, never silently reinterpreted.
}

/** Resolve Woo global attribute IDs against their real parent definitions, never guessed labels. */
export function resolvedVariantRaw(raw: Raw | null = {}, parent: Raw | null = {}): Raw {
    // Synced JSON payloads may be explicitly null; parameter defaults only cover undefined.
    raw = raw ?? {};
    parent = parent ?? {};
    const definitions: Raw[] = Array.isArray(parent.attributes) ? parent.attributes.map(rawRecord).filter((value): value is Raw => !!value) : [];
    const attrs: Raw[] = Array.isArray(raw.attributes) ? raw.attributes.map(rawRecord).filter((value): value is Raw => !!value) : [];
    return { ...raw, attributes: attrs.map((attribute) => {
        const definition = definitions.find((candidate) =>
            (Number(attribute.id) > 0 && Number(candidate.id) === Number(attribute.id))
            || (attribute.slug && candidate.slug === attribute.slug)
            || (attribute.name && String(candidate.name).toLowerCase() === String(attribute.name).toLowerCase()),
        );
        return { ...definition, ...attribute, name: attribute.name || definition?.name, slug: attribute.slug || definition?.slug };
    }) };
}

export function isFeedVariable(product: { rawData?: any; variations?: any[] }): boolean {
    return String(product.rawData?.type || '').includes('variable')
        || (Array.isArray(product.rawData?.variations) && product.rawData.variations.length > 0)
        || (Array.isArray(product.variations) && product.variations.length > 0);
}

/** Preserve Woo's native variant URL. Fallback selections require real keys/term slugs. */
export function variantLandingLink(variation: Raw, parent: Raw): { url: string | null; preselected: boolean } {
    const raw = resolvedVariantRaw(variation.rawData, parent.rawData);
    const base = parent.permalink || parent.rawData?.permalink;
    const direct = raw.permalink;
    try {
        const url = new URL(direct || base);
        if (!['http:', 'https:'].includes(url.protocol)) return { url: direct || base || null, preselected: false };
        const parentUrl = base ? new URL(base) : null;
        if (direct && (url.pathname.replace(/\/+$/, '') !== parentUrl?.pathname.replace(/\/+$/, '') || Array.from(url.searchParams.keys()).some((key) => key.startsWith('attribute_')))) {
            return { url: direct, preselected: true };
        }
        // A parent URL may carry a default selection; never retain it for another variant.
        for (const key of Array.from(url.searchParams.keys())) {
            if (key.startsWith('attribute_')) url.searchParams.delete(key);
        }
        url.searchParams.set('variation_id', String(variation.wooId));
        let preselected = true;
        for (const attr of raw.attributes) {
            const key = String(attr.slug || (Number(attr.id || 0) === 0 && /^[a-z0-9_-]+$/i.test(attr.name || '') ? String(attr.name).toLowerCase() : '')).replace(/^attribute_/, '');
            const taxonomy = String(key || '').startsWith('pa_');
            const knownOption = Array.isArray(attr.options) ? attr.options.find((option: any) => typeof option === 'object' && option?.name === attr.option) : null;
            const option = taxonomy ? attr.option_slug || knownOption?.slug : attr.option;
            if (!key || !option) { preselected = false; continue; }
            url.searchParams.set(`attribute_${String(key).replace(/^attribute_/, '')}`, String(option));
        }
        return { url: url.toString(), preselected: preselected && raw.attributes.length > 0 };
    } catch {
        return { url: direct || base || null, preselected: false };
    }
}
