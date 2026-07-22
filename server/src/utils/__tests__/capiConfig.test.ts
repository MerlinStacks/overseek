import { describe, expect, it } from 'vitest';
import { decrypt } from '../encryption';
import {
    CAPI_SECRET_MASK,
    decryptCapiConfig,
    encryptLegacyCapiConfig,
    maskCapiConfig,
    prepareCapiConfigForStorage,
    redactCapiText,
    validateCapiConfig,
} from '../capiConfig';

describe('capiConfig', () => {
    it('encrypts legacy plaintext secrets without changing public fields', () => {
        const result = encryptLegacyCapiConfig({ pixelId: '123', accessToken: 'legacy-token' });

        expect(result.changed).toBe(true);
        expect(result.config.pixelId).toBe('123');
        expect(result.config.accessToken).not.toBe('legacy-token');
        expect(decryptCapiConfig(result.config).accessToken).toBe('legacy-token');
    });

    it('encrypts secrets while preserving ordinary config fields', () => {
        const stored = prepareCapiConfigForStorage({ pixelId: '123', accessToken: 'token-value' }, {});

        expect(stored.pixelId).toBe('123');
        expect(stored.accessToken).not.toBe('token-value');
        expect(decrypt(stored.accessToken)).toBe('token-value');
    });

    it('preserves encrypted secrets for masked and blank submissions', () => {
        const original = prepareCapiConfigForStorage({ accessToken: 'token-value' }, {});

        expect(prepareCapiConfigForStorage({ accessToken: CAPI_SECRET_MASK }, original).accessToken).toBe(original.accessToken);
        expect(prepareCapiConfigForStorage({ accessToken: '' }, original).accessToken).toBe(original.accessToken);
    });

    it('migrates preserved legacy plaintext and decrypts both formats', () => {
        const migrated = prepareCapiConfigForStorage({ apiSecret: CAPI_SECRET_MASK }, { apiSecret: 'legacy-secret' });

        expect(migrated.apiSecret).not.toBe('legacy-secret');
        expect(decryptCapiConfig(migrated).apiSecret).toBe('legacy-secret');
        expect(decryptCapiConfig({ apiSecret: 'legacy-secret' }).apiSecret).toBe('legacy-secret');
    });

    it('masks secrets without removing optional fields', () => {
        expect(maskCapiConfig({ measurementId: 'G-ABC123', apiSecret: 'secret', useDebugEndpoint: true })).toEqual({
            measurementId: 'G-ABC123',
            apiSecret: CAPI_SECRET_MASK,
            useDebugEndpoint: true,
        });
    });

    it('validates required platform fields and event toggle types', () => {
        expect(validateCapiConfig('meta', true, { pixelId: 'abc', events: { purchase: 'yes' } })).toEqual([
            'events must contain only boolean values',
            'accessToken is required when the platform is enabled',
            'pixelId must contain only digits',
        ]);
        expect(validateCapiConfig('meta', true, { pixelId: '123', accessToken: CAPI_SECRET_MASK, customOptionalField: 'kept' })).toEqual([]);
    });

    it('redacts credentials from errors', () => {
        expect(redactCapiText('request access_token=top-secret failed', { accessToken: 'top-secret' }))
            .toBe('request access_token=[REDACTED] failed');
    });
});
