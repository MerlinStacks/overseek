import { decrypt, encrypt } from './encryption';

export const CAPI_SECRET_MASK = '********';

const SECRET_FIELDS = new Set([
    'accessToken',
    'apiSecret',
    'apiKey',
    'clientSecret',
    'developerToken',
    'refreshToken',
    'secretKey',
]);

function isSecretField(key: string): boolean {
    return SECRET_FIELDS.has(key) || /(?:token|secret|password|apiKey|privateKey)$/i.test(key);
}

const REQUIRED_FIELDS: Record<string, string[]> = {
    meta: ['pixelId', 'accessToken'],
    tiktok: ['pixelCode', 'accessToken'],
    google: ['customerId', 'conversionActionId'],
    pinterest: ['adAccountId', 'accessToken'],
    ga4: ['measurementId', 'apiSecret'],
    snapchat: ['pixelId', 'accessToken'],
    microsoft: ['tagId', 'accessToken'],
    twitter: ['pixelId', 'accessToken', 'eventIdPageView', 'eventIdViewContent', 'eventIdAddToCart', 'eventIdInitiateCheckout', 'eventIdPurchase', 'eventIdSearch'],
};

const STRING_FIELDS: Record<string, string[]> = {
    meta: ['pixelId', 'accessToken', 'testEventCode', 'contentIdFormat', 'contentIdPrefix', 'contentIdSuffix'],
    tiktok: ['pixelCode', 'accessToken'],
    google: ['conversionId', 'conversionLabel', 'conversionLabelPurchase', 'conversionLabelAddToCart', 'conversionLabelBeginCheckout', 'conversionLabelViewItem', 'customerId', 'conversionActionId', 'conversionActionIdAddToCart', 'conversionActionIdBeginCheckout', 'conversionActionIdViewItem', 'merchantId', 'feedCountry', 'feedLanguage'],
    pinterest: ['tagId', 'adAccountId', 'accessToken'],
    ga4: ['measurementId', 'apiSecret'],
    snapchat: ['pixelId', 'accessToken'],
    microsoft: ['tagId', 'accessToken'],
    twitter: ['pixelId', 'accessToken'],
};

const BOOLEAN_FIELDS: Record<string, string[]> = {
    meta: ['advancedMatching', 'excludeShipping', 'excludeTax'],
    tiktok: ['advancedMatching'],
    ga4: ['useDebugEndpoint'],
};

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEncryptedValue(value: string): boolean {
    return /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value);
}

export function maskCapiConfig(config: unknown): Record<string, any> {
    if (!isRecord(config)) return {};
    return Object.fromEntries(Object.entries(config).map(([key, value]) => [
        key,
        isSecretField(key) && typeof value === 'string' && value ? CAPI_SECRET_MASK : value,
    ]));
}

export function decryptCapiConfig(config: unknown): Record<string, any> {
    if (!isRecord(config)) return {};
    return Object.fromEntries(Object.entries(config).map(([key, value]) => [
        key,
        isSecretField(key) && typeof value === 'string' && value ? decrypt(value) : value,
    ]));
}

export function prepareCapiConfigForStorage(
    config: Record<string, any>,
    existingConfig: unknown,
): Record<string, any> {
    const existing = isRecord(existingConfig) ? existingConfig : {};
    const prepared: Record<string, any> = { ...config };

    const secretKeys = new Set([...Object.keys(existing), ...Object.keys(prepared)].filter(isSecretField));
    for (const key of secretKeys) {
        const submitted = prepared[key];
        if (submitted === CAPI_SECRET_MASK || submitted === '' || submitted == null) {
            if (typeof existing[key] === 'string' && existing[key]) {
                prepared[key] = isEncryptedValue(existing[key]) ? existing[key] : encrypt(existing[key]);
            }
            else delete prepared[key];
            continue;
        }
        if (typeof submitted === 'string') prepared[key] = encrypt(submitted);
    }

    return prepared;
}

export function encryptLegacyCapiConfig(config: unknown): { config: Record<string, any>; changed: boolean } {
    if (!isRecord(config)) return { config: {}, changed: false };
    const secured = { ...config };
    let changed = false;
    for (const [key, value] of Object.entries(secured)) {
        if (isSecretField(key) && typeof value === 'string' && value && !isEncryptedValue(value)) {
            secured[key] = encrypt(value);
            changed = true;
        }
    }
    return { config: secured, changed };
}

export function validateCapiConfig(platform: string, enabled: unknown, config: unknown): string[] {
    const errors: string[] = [];
    if (typeof enabled !== 'boolean') errors.push('enabled must be a boolean');
    if (!isRecord(config)) return [...errors, 'config must be an object'];

    for (const field of STRING_FIELDS[platform] || []) {
        const value = config[field];
        if (value !== undefined && value !== null && typeof value !== 'string') {
            errors.push(`${field} must be a string`);
        } else if (typeof value === 'string' && value.length > 4096) {
            errors.push(`${field} is too long`);
        }
    }
    for (const field of BOOLEAN_FIELDS[platform] || []) {
        if (config[field] !== undefined && typeof config[field] !== 'boolean') {
            errors.push(`${field} must be a boolean`);
        }
    }

    if (config.events !== undefined) {
        if (!isRecord(config.events) || Object.values(config.events).some(value => typeof value !== 'boolean')) {
            errors.push('events must contain only boolean values');
        }
    }

    if (enabled === true) {
        for (const field of REQUIRED_FIELDS[platform] || []) {
            const value = config[field];
            if (typeof value !== 'string' || (!value.trim() && value !== CAPI_SECRET_MASK)) {
                errors.push(`${field} is required when the platform is enabled`);
            }
        }
    }

    if (platform === 'meta' && typeof config.pixelId === 'string' && config.pixelId && !/^\d+$/.test(config.pixelId)) {
        errors.push('pixelId must contain only digits');
    }
    if (platform === 'meta' && config.contentIdFormat && !['sku', 'id'].includes(config.contentIdFormat)) {
        errors.push('contentIdFormat must be either sku or id');
    }
    if (platform === 'ga4' && typeof config.measurementId === 'string' && config.measurementId && !/^G-[A-Z0-9]+$/i.test(config.measurementId)) {
        errors.push('measurementId must use the G-XXXXXXXX format');
    }
    if (platform === 'google' && typeof config.customerId === 'string' && config.customerId && !/^\d{3}-?\d{3}-?\d{4}$/.test(config.customerId)) {
        errors.push('customerId must be a 10 digit Google Ads customer ID');
    }

    return errors;
}

export function redactCapiText(value: string | null, config?: Record<string, any>): string | null {
    if (!value) return value;
    let redacted = value
        .replace(/(api_secret|access_token)=([^&\s]+)/gi, '$1=[REDACTED]')
        .replace(/(authorization\s*[:=]\s*(?:bearer|sharedaccesssignature)?\s*)[^\s,}]+/gi, '$1[REDACTED]');

    if (config) {
        for (const [key, secret] of Object.entries(config)) {
            if (!isSecretField(key)) continue;
            if (typeof secret === 'string' && secret && secret !== CAPI_SECRET_MASK) {
                redacted = redacted.split(secret).join('[REDACTED]');
            }
        }
    }
    return redacted;
}
