import { createServer, type IncomingHttpHeaders } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/prisma', () => ({ prisma: {} }));
vi.mock('../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/runtimeMetrics', () => ({ registerRuntimeMetricsProvider: vi.fn() }));

import { WooService } from './woo';

describe('delivery transport over HTTP with the real WooCommerce client', () => {
    let woo: WooService;
    const requests: { headers: IncomingHttpHeaders; path: string; body: string }[] = [];
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            requests.push({ headers: request.headers, path: new URL(request.url!, 'http://localhost').pathname, body });
            // WordPress only populates get_json_params() for JSON content types.
            const parsed = request.headers['content-type']?.startsWith('application/json') ? JSON.parse(body) : null;
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ parsed }));
        });
    });

    beforeAll(async () => {
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server port');
        woo = new WooService({ url: `http://127.0.0.1:${address.port}`, consumerKey: 'ck_test', consumerSecret: 'cs_test', accountId: 'tenant-a' });
    });
    afterAll(async () => {
        WooService.destroyAgents();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    const activation = { schemaVersion: 1, revision: 10, action: 'activate', epoch: null, cursor: null, owners: [], estimateMode: 'production', settingsRevision: 24 };
    const input = { schemaVersion: 1 as const, scope: 'settings', entityId: 0, revision: 24, payload: { enabled: true } };
    const operation = { operationId: 'immutable_uuid', sequence: 1, productWooId: 10, variationWooId: null, stockOwnerWooId: 10, delta: 5 };
    it.each([
        { resource: 'control', payload: activation, send: () => woo.deliveryControl(activation) },
        { resource: 'inputs', payload: input, send: () => woo.postDeliveryInputs(input) },
        { resource: 'receipts/prepare', payload: { schemaVersion: 1, operation }, send: () => woo.postGuardedReceipt('prepare', operation) },
    ])('delivers a parseable JSON $resource envelope and the account header', async ({ resource, payload, send }) => {
        expect(await send()).toEqual({ parsed: payload });
        const request = requests.at(-1)!;
        expect(request.path).toBe(`/wp-json/overseek/v1/delivery-estimates/${resource}`);
        expect(request.headers['x-overseek-account-id']).toBe('tenant-a');
        expect(request.headers.accept).toBe('application/json');
        expect(JSON.parse(request.body)).toEqual(payload);
    });
});
