import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    accountUserFindUnique: vi.fn(),
    mutation: vi.fn(),
    macroFindMany: vi.fn(),
    cannedLabelFindMany: vi.fn(),
    cannedResponseFindMany: vi.fn(),
    listLabels: vi.fn()
}));

vi.mock('../../middleware/auth', () => ({
    requireAuthFastify: async (request: any) => {
        request.user = { id: 'viewer-1' };
        request.accountId = 'account-1';
    }
}));

vi.mock('../../utils/prisma', () => ({
    prisma: {
        accountUser: { findUnique: mocks.accountUserFindUnique },
        inboxMacro: {
            findMany: mocks.macroFindMany,
            findFirst: mocks.mutation,
            create: mocks.mutation,
            update: mocks.mutation,
            delete: mocks.mutation
        },
        cannedResponseLabel: {
            findMany: mocks.cannedLabelFindMany,
            findFirst: mocks.mutation,
            create: mocks.mutation,
            update: mocks.mutation,
            delete: mocks.mutation
        },
        cannedResponse: {
            findMany: mocks.cannedResponseFindMany,
            findFirst: mocks.mutation,
            create: mocks.mutation,
            update: mocks.mutation,
            delete: mocks.mutation
        }
    }
}));

vi.mock('../../services/LabelService', () => ({
    LabelService: class {
        listLabels = mocks.listLabels;
        createLabel = mocks.mutation;
        updateLabel = mocks.mutation;
        deleteLabel = mocks.mutation;
    }
}));

vi.mock('zod', () => {
    const stringSchema: any = {
        min: () => stringSchema,
        max: () => stringSchema,
        regex: () => stringSchema,
        optional: () => stringSchema
    };
    return {
        z: {
            object: () => ({ parse: (value: unknown) => value }),
            string: () => stringSchema
        }
    };
});

import labelsRoutes from '../labels';
import { cannedResponseRoutes } from './cannedResponses';
import { macroRoutes } from './macros';

describe('VIEWER inbox mutation enforcement', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.accountUserFindUnique.mockResolvedValue({ role: 'VIEWER' });
        mocks.macroFindMany.mockResolvedValue([]);
        mocks.cannedLabelFindMany.mockResolvedValue([]);
        mocks.cannedResponseFindMany.mockResolvedValue([]);
        mocks.listLabels.mockResolvedValue([]);

        app = Fastify();
        await app.register(macroRoutes, { prefix: '/chat' });
        await app.register(cannedResponseRoutes, { prefix: '/chat' });
        await app.register(labelsRoutes, { prefix: '/labels' });
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    it.each([
        ['POST', '/chat/macros'],
        ['PUT', '/chat/macros/macro-1'],
        ['DELETE', '/chat/macros/macro-1'],
        ['POST', '/chat/macros/macro-1/execute'],
        ['POST', '/chat/canned-labels'],
        ['PUT', '/chat/canned-labels/label-1'],
        ['DELETE', '/chat/canned-labels/label-1'],
        ['POST', '/chat/canned-responses'],
        ['PUT', '/chat/canned-responses/response-1'],
        ['DELETE', '/chat/canned-responses/response-1'],
        ['POST', '/labels'],
        ['PUT', '/labels/label-1'],
        ['DELETE', '/labels/label-1']
    ])('blocks %s %s before persistence', async (method, url) => {
        const response = await app.inject({ method, url, payload: {} });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'Inbox mutation access required' });
        expect(mocks.mutation).not.toHaveBeenCalled();
    });

    it.each([
        '/chat/macros',
        '/chat/canned-labels',
        '/chat/canned-responses',
        '/labels'
    ])('keeps GET %s readable', async (url) => {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(200);
    });
});
