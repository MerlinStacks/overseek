import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../utils/prisma';
import { updateCustomerTotals, withOrderTotalsTransaction } from '../orderCustomerTotals';

vi.mock('../../../utils/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('../../../utils/elastic', () => ({ esClient: {} }));
vi.mock('../../../utils/logger', () => ({ Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Run with ORDER_TOTALS_TEST_DATABASE_URL=postgresql://... npx vitest run
// src/services/sync/__tests__/orderCustomerTotals.sql.test.ts
// Only connection-local TEMP tables are created; no application schema or migrations needed.
const databaseUrl = process.env.ORDER_TOTALS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('customer totals PostgreSQL regression', () => {
    const db = new Client({ connectionString: databaseUrl });
    const query = (strings: TemplateStringsArray, ...values: unknown[]) => db.query(
        strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, ''), values
    );
    // Execute the production helper's parameterized SQL, not a copy or a JS aggregate simulation.
    const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await query(strings, ...values)).rowCount,
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => (await query(strings, ...values)).rows
    } as unknown as Prisma.TransactionClient;
    const totals = async () => (await db.query(`
        SELECT id, "ordersCount" AS count, "totalSpent"::text AS spent FROM "WooCustomer" ORDER BY id
    `)).rows;

    beforeAll(async () => {
        await db.connect();
        await db.query(`
            CREATE TEMP TABLE "SyncState" (
                id text PRIMARY KEY, "accountId" text, "entityType" text, cursor text, "updatedAt" timestamp,
                UNIQUE ("accountId", "entityType")
            );
            CREATE TEMP TABLE "WooCustomer" (
                id text PRIMARY KEY, "accountId" text NOT NULL, "wooId" int NOT NULL, email text NOT NULL,
                "ordersCount" int NOT NULL, "totalSpent" numeric(10,2) NOT NULL, "updatedAt" timestamp NOT NULL
            );
            ALTER TABLE "WooCustomer" ADD COLUMN "rawData" jsonb DEFAULT '{}';
            CREATE TEMP TABLE "WooOrder" (
                id text PRIMARY KEY, "accountId" text NOT NULL, "wooCustomerId" int,
                "billingEmail" text, total numeric(10,2) NOT NULL, status text NOT NULL
            );
            ALTER TABLE "WooOrder" ADD COLUMN "wooId" int;
        `);
        vi.mocked(prisma.$transaction).mockImplementation(async (work: any) => {
            await db.query('BEGIN');
            try {
                const result = await work(tx);
                await db.query('COMMIT');
                return result;
            } catch (error) {
                await db.query('ROLLBACK');
                throw error;
            }
        });
    });

    afterAll(async () => { await db.end(); });

    beforeEach(async () => {
        await db.query(`
            TRUNCATE "WooCustomer", "WooOrder", "SyncState";
            INSERT INTO "WooCustomer" (id, "accountId", "wooId", email, "ordersCount", "totalSpent", "updatedAt") VALUES
                ('old', 'a', 1, 'old@example.com', 99, 99, '2020-01-01'),
                ('new', 'a', 2, 'new@example.com', 99, 99, '2020-01-01'),
                ('duplicate', 'a', 3, 'new@example.com', 99, 99, '2020-01-01'),
                ('empty', 'a', 4, 'empty@example.com', 99, 99, '2020-01-01'),
                ('other', 'b', 1, 'old@example.com', 99, 99, '2020-01-01');
            INSERT INTO "WooOrder" (id, "accountId", "wooCustomerId", "billingEmail", total, status) VALUES
                ('registered', 'a', 1, 'new@example.com', 10.10, 'cancelled'),
                ('guest', 'a', NULL, 'new@example.com', 20.20, 'refunded'),
                ('unmatched', 'a', 999, 'new@example.com', 100, 'completed'),
                ('other-order', 'b', 1, 'old@example.com', 500, 'completed');
        `);
    });

    it('preserves all-status semantics, decimal precision, ID precedence and tenant isolation', async () => {
        await withOrderTotalsTransaction('a', tx => updateCustomerTotals(tx, 'a', [
            { wooCustomerId: 1, billingEmail: 'new@example.com' },
            { wooCustomerId: null, billingEmail: 'new@example.com' }
        ], ['empty']));
        expect(await totals()).toEqual([
            { id: 'duplicate', count: 1, spent: '20.20' },
            { id: 'empty', count: 0, spent: '0.00' },
            { id: 'new', count: 1, spent: '20.20' },
            { id: 'old', count: 1, spent: '10.10' },
            { id: 'other', count: 99, spent: '99.00' }
        ]);
    });

    it('repairs old and new owners after reassignment and last-order deletion', async () => {
        await withOrderTotalsTransaction('a', async tx => {
            await db.query(`UPDATE "WooOrder" SET "wooCustomerId" = 2 WHERE id = 'registered';
                DELETE FROM "WooOrder" WHERE id = 'guest'`);
            await updateCustomerTotals(tx, 'a', [
                { wooCustomerId: 1, billingEmail: null }, { wooCustomerId: 2, billingEmail: null },
                { wooCustomerId: null, billingEmail: 'new@example.com' }
            ]);
        });
        expect(await totals()).toEqual([
            { id: 'duplicate', count: 0, spent: '0.00' },
            { id: 'empty', count: 99, spent: '99.00' },
            { id: 'new', count: 1, spent: '10.10' },
            { id: 'old', count: 0, spent: '0.00' },
            { id: 'other', count: 99, spent: '99.00' }
        ]);
    });

    it('handles guest email changes and registered-to-guest transitions without double counting', async () => {
        await withOrderTotalsTransaction('a', async tx => {
            await db.query(`UPDATE "WooOrder" SET "billingEmail" = 'old@example.com' WHERE id = 'guest';
                UPDATE "WooOrder" SET "wooCustomerId" = NULL WHERE id = 'registered'`);
            await updateCustomerTotals(tx, 'a', [
                { wooCustomerId: 1, billingEmail: 'new@example.com' },
                { wooCustomerId: null, billingEmail: 'new@example.com' },
                { wooCustomerId: null, billingEmail: 'old@example.com' }
            ]);
        });
        expect(await totals()).toEqual(expect.arrayContaining([
            { id: 'old', count: 1, spent: '20.20' },
            { id: 'new', count: 1, spent: '10.10' },
            { id: 'duplicate', count: 1, spent: '10.10' }
        ]));
    });

    it('rolls back order mutation and customer updates when any aggregate overflows', async () => {
        const before = await totals();
        await expect(withOrderTotalsTransaction('a', async tx => {
            await db.query(`INSERT INTO "WooOrder" (id, "accountId", "wooCustomerId", "billingEmail", total, status) VALUES ('overflow', 'a', 1, NULL, 99999999.99, 'completed')`);
            await updateCustomerTotals(tx, 'a', [{ wooCustomerId: 1, billingEmail: null }]);
        })).rejects.toThrow(/overflow/i);
        expect(await totals()).toEqual(before);
        expect((await db.query(`SELECT id FROM "WooOrder" WHERE id = 'overflow'`)).rows).toEqual([]);
    });

    it('is idempotent and does not keep unchanged customers in the recovery window', async () => {
        const associations = [{ wooCustomerId: 1, billingEmail: null }];
        await withOrderTotalsTransaction('a', tx => updateCustomerTotals(tx, 'a', associations));
        const pending = (await db.query(`SELECT "accountId", "entityType", cursor FROM "SyncState"`)).rows;
        expect(pending).toEqual([{ accountId: 'a', entityType: 'contact-projection:1', cursor: expect.any(String) }]);
        await db.query(`UPDATE "WooCustomer" SET "updatedAt" = '2020-01-01' WHERE id = 'old'`);
        await withOrderTotalsTransaction('a', tx => updateCustomerTotals(tx, 'a', associations));
        expect((await db.query(`SELECT "accountId", "entityType", cursor FROM "SyncState"`)).rows).toEqual(pending);
        expect((await db.query(`SELECT "updatedAt"::text AS date FROM "WooCustomer" WHERE id = 'old'`)).rows)
            .toEqual([{ date: '2020-01-01 00:00:00' }]);
        expect(await totals()).toContainEqual({ id: 'old', count: 1, spent: '10.10' });
    });

    it('serializes the same account across connections and releases the lock on rollback', async () => {
        const contender = new Client({ connectionString: databaseUrl });
        await contender.connect();
        const tryLock = async (accountId: string) => (await contender.query(
            'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked', [`order-totals:${accountId}`]
        )).rows[0].locked;
        try {
            await expect(withOrderTotalsTransaction('a', async () => {
                expect(await tryLock('a')).toBe(false);
                expect(await tryLock('b')).toBe(true);
                throw new Error('rollback');
            })).rejects.toThrow('rollback');
            expect(await tryLock('a')).toBe(true);
        } finally {
            await contender.end();
        }
    });
});
