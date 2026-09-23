import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeExecutor } from '../NodeExecutor';
import { prisma } from '../../../utils/prisma';
import { snapshotFixture, snapshotMetadata } from '../../deliveryEstimates/__tests__/snapshotFixture';

const mocks = vi.hoisted(() => ({
    sendEmail: vi.fn(),
    trackSend: vi.fn(),
    buildContext: vi.fn(),
    createRecoveryUrl: vi.fn(),
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

vi.mock('../../../utils/prisma', () => ({
    prisma: {
        account: {
            findFirst: vi.fn()
        },
        wooCustomer: {
            findFirst: vi.fn()
        },
        wooOrder: { findFirst: vi.fn() },
        wooProduct: { findMany: vi.fn() },
        emailLog: { findFirst: vi.fn() },
        reviewRequest: { upsert: vi.fn() },
        emailUnsubscribe: { upsert: vi.fn() },
        emailListMember: { updateMany: vi.fn() },
        $transaction: vi.fn()
    }
}));

vi.mock('../../../utils/logger', () => ({
    Logger: mocks.logger
}));

vi.mock('../../EmailService', () => ({
    EmailService: class {
        sendEmail = mocks.sendEmail;
    }
}));

vi.mock('../../CampaignTrackingService', () => ({
    campaignTrackingService: {
        trackSend: mocks.trackSend
    }
}));

vi.mock('../../CartRecoveryService', () => ({
    cartRecoveryService: {
        createRecoveryUrl: mocks.createRecoveryUrl
    }
}));

vi.mock('../../AutomationContextService', async importOriginal => ({
    ...await importOriginal<typeof import('../../AutomationContextService')>(),
    automationContextService: {
        buildContext: mocks.buildContext
    }
}));

vi.mock('../../CanonicalInvoiceAttachmentService', () => ({
    canonicalInvoiceAttachmentService: {}
}));

vi.mock('../../SmsService', () => ({
    smsService: {}
}));

vi.mock('../../AutomationConditionService', () => ({
    automationConditionService: {}
}));

vi.mock('../../AutomationCouponService', () => ({
    automationCouponService: {}
}));

vi.mock('../../woo', () => ({
    WooService: class {}
}));

vi.mock('../../../utils/getDefaultEmailAccount', () => ({
    getDefaultEmailAccount: vi.fn(async () => ({ id: 'email-account-1' }))
}));

const buildEnrollment = () => ({
    id: 'enrollment-1',
    automationId: 'automation-1',
    email: 'customer@example.com',
    wooCustomerId: null,
    contextData: {},
    automation: {
        id: 'automation-1',
        accountId: 'account-1'
    }
});

const executeEmailNode = (config: Record<string, unknown>) => {
    const executor = new NodeExecutor();
    return executor.execute({
        id: 'node-1',
        type: 'ACTION',
        data: {
            config: {
                actionType: 'SEND_EMAIL',
                to: '{{customer.email}}',
                subject: 'Order update',
                htmlContent: '<p>Your order update</p>',
                ...config
            }
        }
    }, buildEnrollment());
};

describe('NodeExecutor email category', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.account.findFirst).mockResolvedValue({ wooUrl: 'https://store.test', domain: null } as any);
        vi.mocked(prisma.wooCustomer.findFirst).mockResolvedValue(null);
        mocks.buildContext.mockImplementation(async input => {
            const { AutomationContextService } = await vi.importActual<typeof import('../../AutomationContextService')>('../../AutomationContextService');
            return new AutomationContextService().buildContext(input);
        });
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([]);
        mocks.createRecoveryUrl.mockReturnValue('https://store.test/recover');
        mocks.sendEmail.mockResolvedValue({ messageId: 'message-1' });
        mocks.trackSend.mockResolvedValue(undefined);
    });

    it('actual send hydrates the exact stored snapshot rather than changed event metadata', async () => {
        const enrollment = { ...buildEnrollment(), contextData: { order: { id: 42, estimatedDeliveryStart: 'invented promise', meta_data: snapshotMetadata(null) } } };
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: { id: 42 }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        await new NodeExecutor().execute({ id: 'node', type: 'ACTION', data: { config: {
            actionType: 'SEND_EMAIL', subject: '{{order.estimatedDeliveryStart}}',
            htmlContent: '<p>{{order.estimatedFulfilment}}</p>{{delivery_estimate showDispatch:true}}'
        } } }, enrollment);
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-1', wooId: 42 } }));
        expect(mocks.buildContext).toHaveBeenCalledWith(expect.objectContaining({ exactEmailOrder: true }));
        expect(mocks.sendEmail.mock.calls[0][3]).toBe('25 Sept 2026');
        expect(mocks.sendEmail.mock.calls[0][4]).toContain('Estimated delivery');
        expect(mocks.sendEmail.mock.calls[0][4]).toContain('Estimated dispatch');
    });

    it('actual non-order send never loads an unrelated latest order', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: { id: 42 }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        await executeEmailNode({ htmlContent: '<p>Hello</p>{{delivery_estimate}}{{order.estimatedDelivery}}' });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ select: { dateCreated: true } }));
        expect(mocks.sendEmail.mock.calls[0][4]).toBe('<p>Hello</p>');
    });

    it.each([
        { id: 42, billing: { email: 'new@example.com', first_name: 'New customer' } },
        { wooId: 42, billing: { email: 'new@example.com' } },
        { id: 42, rawData: { id: 42, billing: { email: 'new@example.com' } } }
    ])('customer-created payload cannot load same-account order with colliding ID: %j', async contextData => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: {
            id: 42, number: 'PRIVATE-ORDER', billing: { email: 'other@example.com' }, line_items: [{ name: 'Private item' }]
        }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        await new NodeExecutor().execute({ id: 'email', type: 'ACTION', data: { config: {
            subject: 'Welcome', htmlContent: '<p>Hello</p>{{order.itemsTable}}{{order.estimatedDelivery}}{{delivery_estimate}}'
        } } }, { ...buildEnrollment(), contextData });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ select: { dateCreated: true } }));
        const html = mocks.sendEmail.mock.calls[0][4];
        expect(html).not.toContain('Private item');
        expect(html).not.toContain('other@example.com');
        expect(html).not.toContain('Estimated delivery');
    });

    it('shipment reference retains the real order identity/status and enriches review links', async () => {
        vi.mocked(prisma.wooOrder.findFirst).mockResolvedValue({ rawData: {
            id: 42, status: 'processing', line_items: [{ product_id: 7, name: 'Original item' }]
        }, deliveryEstimateSnapshot: snapshotFixture() } as any);
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([{ wooId: 7, permalink: 'https://store.test/product/exact-item', rawData: {} }] as any);
        await new NodeExecutor().execute({ id: 'email', type: 'ACTION', data: { config: {
            subject: '{{order.number}} {{order.status}}', htmlContent: '{{order.reviewLinks}}{{delivery_estimate}}'
        } } }, { ...buildEnrollment(), contextData: { id: 'shipment-id', orderId: 'order-id', status: 'in_transit' } });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-1', id: 'order-id' } }));
        expect(prisma.wooProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'account-1', wooId: { in: [7] } } }));
        expect(mocks.sendEmail.mock.calls[0][3]).toBe('42 processing');
        expect(mocks.sendEmail.mock.calls[0][4]).toContain('https://store.test/product/exact-item');
        expect(mocks.sendEmail.mock.calls[0][4]).toContain('Estimated delivery');
    });

    it.each(['lineItems', 'items'])('legacy %s without an ID keeps item tags but blanks snapshots', async field => {
        await new NodeExecutor().execute({ id: 'email', type: 'ACTION', data: { config: {
            subject: 'Legacy', htmlContent: '{{order.itemsTable}}{{delivery_estimate}}{{order.estimatedDelivery}}'
        } } }, { ...buildEnrollment(), contextData: { [field]: [{ name: 'Legacy item', quantity: 1 }], deliveryEstimateSnapshot: snapshotFixture() } });
        expect(prisma.wooOrder.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ select: { dateCreated: true } }));
        expect(mocks.sendEmail.mock.calls[0][4]).toContain('Legacy item');
        expect(mocks.sendEmail.mock.calls[0][4]).not.toContain('Estimated delivery');
    });

    it('passes explicit transactional category to the email sender', async () => {
        await executeEmailNode({ emailCategory: 'TRANSACTIONAL' });

        expect(mocks.sendEmail).toHaveBeenCalledWith(
            'account-1',
            'email-account-1',
            'customer@example.com',
            'Order update',
            '<p>Your order update</p>',
            undefined,
            expect.objectContaining({ category: 'TRANSACTIONAL' })
        );
    });

    it('treats legacy isTransactional nodes as transactional', async () => {
        await executeEmailNode({ isTransactional: true });

        expect(mocks.sendEmail).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.any(String),
            expect.any(String),
            expect.any(String),
            undefined,
            expect.objectContaining({ category: 'TRANSACTIONAL' })
        );
    });

    it('classifies automation ALL suppression as unsubscribed on both write paths', async () => {
        const result = await new NodeExecutor().execute({
            id: 'unsubscribe-node',
            type: 'ACTION',
            data: { config: { actionType: 'UNSUBSCRIBE' } }
        }, buildEnrollment());

        expect(result.outcome).toBe('UNSUBSCRIBED');
        expect(prisma.emailUnsubscribe.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ scope: 'ALL', contactStatus: 'UNSUBSCRIBED' }),
            update: expect.objectContaining({ scope: 'ALL', contactStatus: 'UNSUBSCRIBED' })
        }));
    });
});
