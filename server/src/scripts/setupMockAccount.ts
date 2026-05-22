import { prisma } from '../utils/prisma';
import { hashPassword } from '../utils/auth';
import { Logger } from '../utils/logger';

const MOCK_USER_EMAIL = process.env.MOCK_USER_EMAIL ?? 'mock@overseek.local';
const MOCK_USER_PASSWORD = process.env.MOCK_USER_PASSWORD ?? 'MockPassword123';
const MOCK_USER_NAME = process.env.MOCK_USER_NAME ?? 'Mock User';

const MOCK_ACCOUNT_NAME = process.env.MOCK_ACCOUNT_NAME ?? 'Mock Store';
const MOCK_ACCOUNT_DOMAIN = process.env.MOCK_ACCOUNT_DOMAIN ?? 'mock-store.local';
const MOCK_WOO_URL = process.env.MOCK_WOO_URL ?? 'https://mock-store.local';
const MOCK_WOO_CONSUMER_KEY = process.env.MOCK_WOO_CONSUMER_KEY ?? 'ck_mock_consumer_key';
const MOCK_WOO_CONSUMER_SECRET = process.env.MOCK_WOO_CONSUMER_SECRET ?? 'cs_mock_consumer_secret';

type MockAccountSetupResult = {
    userId: string;
    accountId: string;
    email: string;
    password: string;
};

async function setupMockAccount(): Promise<MockAccountSetupResult> {
    const normalizedEmail = MOCK_USER_EMAIL.trim().toLowerCase();

    if (!normalizedEmail) {
        throw new Error('MOCK_USER_EMAIL is required');
    }

    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
        const passwordHash = await hashPassword(MOCK_USER_PASSWORD);
        user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                passwordHash,
                fullName: MOCK_USER_NAME,
                isSuperAdmin: false,
            },
        });
        Logger.info('[setupMockAccount] Created mock user', { email: normalizedEmail, userId: user.id });
    } else {
        Logger.info('[setupMockAccount] Mock user already exists', { email: normalizedEmail, userId: user.id });
    }

    const existingMembership = await prisma.accountUser.findFirst({
        where: { userId: user.id },
        include: { account: true },
        orderBy: { createdAt: 'asc' },
    });

    if (existingMembership?.account) {
        Logger.info('[setupMockAccount] Existing account membership found', {
            accountId: existingMembership.account.id,
            accountName: existingMembership.account.name,
            userId: user.id,
        });
        Logger.info('[setupMockAccount] Ready for local login', {
            email: normalizedEmail,
            password: MOCK_USER_PASSWORD,
            accountId: existingMembership.account.id,
        });
        return {
            userId: user.id,
            accountId: existingMembership.account.id,
            email: normalizedEmail,
            password: MOCK_USER_PASSWORD,
        };
    }

    const account = await prisma.account.create({
        data: {
            name: MOCK_ACCOUNT_NAME,
            domain: MOCK_ACCOUNT_DOMAIN,
            wooUrl: MOCK_WOO_URL,
            wooConsumerKey: MOCK_WOO_CONSUMER_KEY,
            wooConsumerSecret: MOCK_WOO_CONSUMER_SECRET,
            users: {
                create: {
                    userId: user.id,
                    role: 'OWNER',
                },
            },
        },
    });

    Logger.info('[setupMockAccount] Created mock account', {
        accountId: account.id,
        accountName: account.name,
        userId: user.id,
    });

    Logger.info('[setupMockAccount] Ready for local login', {
        email: normalizedEmail,
        password: MOCK_USER_PASSWORD,
        accountId: account.id,
    });

    return {
        userId: user.id,
        accountId: account.id,
        email: normalizedEmail,
        password: MOCK_USER_PASSWORD,
    };
}

if (require.main === module) {
    setupMockAccount()
        .then(() => process.exit(0))
        .catch((error) => {
            Logger.error('[setupMockAccount] Failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            process.exit(1);
        });
}

export { setupMockAccount };
export type { MockAccountSetupResult };
