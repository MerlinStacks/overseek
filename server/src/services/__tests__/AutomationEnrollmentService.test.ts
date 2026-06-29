import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationEnrollmentService } from '../AutomationEnrollmentService';
import { prisma } from '../../utils/prisma';

const { prismaMock } = vi.hoisted(() => {
    const mock: any = {
        $executeRaw: vi.fn(),
        automationEnrollment: {
            findFirst: vi.fn(),
            create: vi.fn()
        },
        automationRunEvent: {
            create: vi.fn()
        }
    };
    mock.$transaction = vi.fn(async (callback: any) => callback(mock));
    return { prismaMock: mock };
});

vi.mock('../../utils/prisma', () => ({
    prisma: prismaMock
}));

vi.mock('../../utils/logger', () => ({
    Logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

const automation = {
    id: 'automation-1',
    accountId: 'account-1'
};

describe('AutomationEnrollmentService dedupe', () => {
    const service = new AutomationEnrollmentService();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.automationEnrollment.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.automationEnrollment.create).mockResolvedValue({ id: 'enrollment-1' } as any);
        vi.mocked(prisma.automationRunEvent.create).mockResolvedValue({} as any);
        vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as any);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    });

    it('dedupes against any prior enrollment when dedupe scope is ANY', async () => {
        await service.createEnrollment({
            automation: automation as any,
            email: 'customer@example.com',
            dedupeKey: 'ORDER_CREATED:123:customer@example.com',
            dedupeScope: 'ANY'
        });

        expect(prisma.automationEnrollment.findFirst).toHaveBeenCalledWith({
            where: {
                accountId: 'account-1',
                automationId: 'automation-1',
                dedupeKey: 'ORDER_CREATED:123:customer@example.com'
            }
        });
    });

    it('keeps active-only dedupe as the default', async () => {
        await service.createEnrollment({
            automation: automation as any,
            email: 'customer@example.com',
            dedupeKey: 'ABANDONED_CART:session-1'
        });

        expect(prisma.automationEnrollment.findFirst).toHaveBeenCalledWith({
            where: {
                accountId: 'account-1',
                automationId: 'automation-1',
                dedupeKey: 'ABANDONED_CART:session-1',
                status: 'ACTIVE'
            }
        });
    });
});
