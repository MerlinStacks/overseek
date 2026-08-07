import { describe, expect, it } from 'vitest';
import { sanitizeAccountResponse } from './accountResponse';

describe('sanitizeAccountResponse', () => {
    it('removes account credentials and reports configuration state', () => {
        const response = sanitizeAccountResponse({
            id: 'account-1',
            name: 'Store',
            wooConsumerKey: 'consumer-key',
            wooConsumerSecret: 'consumer-secret',
            webhookSecret: 'webhook-secret',
            openRouterApiKey: 'openrouter-key',
        });

        expect(response).toEqual({
            id: 'account-1',
            name: 'Store',
            wooCredentialsConfigured: true,
            webhookSecretConfigured: true,
            openRouterApiKeyConfigured: true,
        });
        expect(response).not.toHaveProperty('wooConsumerKey');
        expect(response).not.toHaveProperty('wooConsumerSecret');
        expect(response).not.toHaveProperty('webhookSecret');
        expect(response).not.toHaveProperty('openRouterApiKey');
    });
});
