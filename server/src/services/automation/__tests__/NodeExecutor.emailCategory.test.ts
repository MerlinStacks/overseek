import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeExecutor } from '../NodeExecutor';
import { prisma } from '../../../utils/prisma';

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
        }
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

vi.mock('../../AutomationContextService', () => ({
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
        mocks.buildContext.mockResolvedValue({ customer: { email: 'customer@example.com' } });
        mocks.createRecoveryUrl.mockReturnValue('https://store.test/recover');
        mocks.sendEmail.mockResolvedValue({ messageId: 'message-1' });
        mocks.trackSend.mockResolvedValue(undefined);
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
});
