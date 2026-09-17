import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CustomersService } from '../customers';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../utils/prisma', () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock('../../utils/elastic', () => ({ esClient: {} }));
vi.mock('../../utils/logger', () => ({ Logger: {} }));
vi.mock('../woo', () => ({ WooService: {} }));
vi.mock('../search/IndexingService', () => ({ IndexingService: {} }));
vi.mock('../automation/ContactAutomationHistory', () => ({ getContactAutomationHistory: vi.fn() }));

// No repository dependency required. Opt in with CONTACT_STATUS_PGLITE_MODULE=@electric-sql/pglite
// (if locally installed), or an absolute path to an external PGlite module under /tmp/opencode.
// Missing/broken modules fail an explicitly requested run rather than silently skipping it.
const modulePath = process.env.CONTACT_STATUS_PGLITE_MODULE;
type TestDatabase = {
    exec(sql: string): Promise<unknown>;
    query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    close(): Promise<void>;
};

describe.skipIf(!modulePath)('contact-list SQL classification and counts (PGlite)', () => {
    let db: TestDatabase;
    const cases = [
        ['explicit-optout', 'ALL', 'UNSUBSCRIBED', 'COMPLAINT', 'UNSUBSCRIBED'],
        ['explicit-bounce', 'ALL', 'BOUNCED', 'COMPLAINT', 'BOUNCED'],
        ['explicit-complaint', 'MARKETING', 'COMPLAINT', 'BOUNCED', 'COMPLAINT'],
        ['explicit-soft', 'ALL', 'SOFT_BOUNCED', 'SUBSCRIBED', 'SOFT_BOUNCED'],
        ['explicit-unverified', 'MARKETING', 'UNVERIFIED', 'COMPLAINT', 'UNVERIFIED'],
        ['legacy-all', 'ALL', null, 'SUBSCRIBED', 'UNSUBSCRIBED'],
        ['legacy-marketing', 'MARKETING', null, 'UNVERIFIED', 'UNSUBSCRIBED'],
        ['legacy-complaint', 'ALL', null, 'COMPLAINT', 'COMPLAINT'],
        ['legacy-bounce', 'MARKETING', null, 'BOUNCED', 'BOUNCED'],
        ['legacy-soft', 'ALL', null, 'SOFT_BOUNCED', 'SOFT_BOUNCED'],
        ['legacy-missing', 'ALL', null, null, 'UNSUBSCRIBED'],
        ['legacy-invalid', 'MARKETING', null, 'invalid', 'UNSUBSCRIBED'],
        ['plain-subscriber', null, null, 'SUBSCRIBED', 'SUBSCRIBED'],
        ['plain-unverified', null, null, 'UNVERIFIED', 'UNVERIFIED']
    ] as const;
    const expectedCounts = {
        ALL: 14, UNVERIFIED: 2, SUBSCRIBED: 1, BOUNCED: 2, UNSUBSCRIBED: 5,
        SOFT_BOUNCED: 2, COMPLAINT: 2, BLOCKED: 0
    };

    beforeAll(async () => {
        const { PGlite } = createRequire(`${process.cwd()}/package.json`)(modulePath!);
        db = new PGlite();
        await db.exec(`
            CREATE TABLE "WooCustomer" (
                "id" text PRIMARY KEY, "accountId" text, "wooId" integer, "email" text,
                "firstName" text, "lastName" text, "totalSpent" numeric DEFAULT 0,
                "ordersCount" integer DEFAULT 0, "rawData" jsonb,
                "createdAt" timestamp DEFAULT now(), "updatedAt" timestamp DEFAULT now()
            );
            CREATE TABLE "EmailUnsubscribe" (
                "accountId" text, "email" text, "scope" text, "contactStatus" text,
                "createdAt" timestamp DEFAULT now()
            );
            CREATE TABLE "BlockedContact" (
                "id" text, "accountId" text, "email" text, "reason" text,
                "blockedAt" timestamp DEFAULT now(), "blockedBy" text
            );
            CREATE TABLE "User" ("id" text, "fullName" text);
        `);
        for (const [id, scope, explicit, raw] of cases) {
            await db.query(`INSERT INTO "WooCustomer"
                ("id", "accountId", "wooId", "email", "firstName", "lastName", "rawData")
                VALUES ($1, 'account', -1, $2, 'Fixture', $1, $3::jsonb)`,
            [id, `${id}@example.com`, JSON.stringify({ contactStatus: raw })]);
            if (scope) await db.query(`INSERT INTO "EmailUnsubscribe"
                ("accountId", "email", "scope", "contactStatus") VALUES ('account', $1, $2, $3)`,
            [` ${id.toUpperCase()}@EXAMPLE.COM `, scope, explicit]);
        }
        // These must not inflate counts or override the selected account's labels.
        await db.exec(`
            INSERT INTO "WooCustomer" ("id", "accountId", "email", "firstName", "rawData")
                VALUES ('foreign', 'other', 'foreign@example.com', 'Fixture', '{"contactStatus":"COMPLAINT"}');
            INSERT INTO "EmailUnsubscribe" ("accountId", "email", "scope", "contactStatus")
                VALUES ('other', 'plain-subscriber@example.com', 'ALL', 'COMPLAINT');
            INSERT INTO "BlockedContact" ("id", "accountId", "email")
                VALUES ('foreign-block', 'other', 'plain-subscriber@example.com');
            INSERT INTO "WooCustomer" ("id", "accountId", "email", "firstName", "ordersCount", "rawData")
                VALUES ('duplicate', 'account', ' EXPLICIT-OPTOUT@example.com ', 'Duplicate', -1, '{}');
            INSERT INTO "User" VALUES ('admin', 'Test Admin');
            INSERT INTO "BlockedContact" ("id", "accountId", "email", "reason", "blockedBy") VALUES
                ('standalone-block', 'account', 'blocked@example.com', 'Abuse', 'admin'),
                ('customer-block', 'account', 'blocked-customer@example.com', 'Abuse', 'admin');
            INSERT INTO "WooCustomer" ("id", "accountId", "email", "firstName", "rawData")
                VALUES ('blocked-customer', 'account', 'BLOCKED-CUSTOMER@example.com', 'Blocked', '{"contactStatus":"COMPLAINT"}');
            INSERT INTO "EmailUnsubscribe" ("accountId", "email", "scope", "contactStatus")
                VALUES ('account', 'blocked-customer@example.com', 'ALL', 'BOUNCED');
        `);
        mocks.query.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const sql = Prisma.sql(strings, ...values);
            return (await db.query(sql.text, sql.values)).rows;
        });
    }, 30_000);

    afterAll(async () => { await db?.close(); });

    it('executes the actual parameterized service SQL and classifies explicit and legacy suppressions', async () => {
        const result = await CustomersService.searchContacts('account', 'Fixture', 1, 100);
        expect(Object.fromEntries(result.contacts.map(row => [row.id, row.contactStatus])))
            .toEqual(Object.fromEntries(cases.map(([id, , , , expected]) => [id, expected])));
        expect(result.statusCounts).toEqual(expectedCounts);
        expect(result.total).toBe(14);
    });

    it.each(['UNVERIFIED', 'SUBSCRIBED', 'BOUNCED', 'UNSUBSCRIBED', 'SOFT_BOUNCED', 'COMPLAINT'] as const)(
        'filters %s after search while retaining all searched status counts', async status => {
            const result = await CustomersService.searchContacts('account', 'Fixture', 1, 100, status);
            expect(result.contacts.map(row => row.id).sort())
                .toEqual(cases.filter(row => row[4] === status).map(row => row[0]).sort());
            expect(result.total).toBe(expectedCounts[status]);
            expect(result.statusCounts).toEqual(expectedCounts);
        }
    );

    it('paginates the effective status and keeps counts on an out-of-range page', async () => {
        const first = await CustomersService.searchContacts('account', 'Fixture', 1, 2, 'UNSUBSCRIBED');
        const second = await CustomersService.searchContacts('account', 'Fixture', 2, 2, 'UNSUBSCRIBED');
        expect(first.contacts.map(row => row.id)).toEqual(['explicit-optout', 'legacy-all']);
        expect(second.contacts.map(row => row.id)).toEqual(['legacy-invalid', 'legacy-marketing']);
        const empty = await CustomersService.searchContacts('account', 'Fixture', 4, 2, 'UNSUBSCRIBED');
        expect(empty).toMatchObject({ contacts: [], total: 5, totalPages: 3, page: 4, statusCounts: expectedCounts });
    });

    it('gives blocking precedence, includes standalone blocks once, and searches reasons', async () => {
        const all = await CustomersService.searchContacts('account', '', 1, 100);
        expect(all.statusCounts).toEqual({ ...expectedCounts, ALL: 16, BLOCKED: 2 });
        const blocked = await CustomersService.searchContacts('account', 'Abuse', 1, 100, 'BLOCKED');
        expect(blocked.contacts).toHaveLength(2);
        expect(blocked.contacts).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'standalone-block', isCustomer: false, contactStatus: 'BLOCKED', blockedByName: 'Test Admin' }),
            expect.objectContaining({ id: 'blocked-customer', isCustomer: true, contactStatus: 'BLOCKED' })
        ]));
        expect(blocked.statusCounts).toEqual({
            ALL: 2, BLOCKED: 2, SUBSCRIBED: 0, UNVERIFIED: 0, BOUNCED: 0,
            SOFT_BOUNCED: 0, COMPLAINT: 0, UNSUBSCRIBED: 0
        });
    });

    it('normalizes full-name search and safely binds SQL-looking input', async () => {
        const match = await CustomersService.searchContacts('account', ' Fixture \t explicit-optout ');
        expect(match.contacts.map(row => row.id)).toEqual(['explicit-optout']);
        expect(match.total).toBe(1);
        const noMatch = await CustomersService.searchContacts('account', "' OR TRUE --");
        expect(noMatch.contacts).toEqual([]);
        expect(noMatch.total).toBe(0);
        expect(Object.values(noMatch.statusCounts)).toEqual(Array(8).fill(0));
    });
});
