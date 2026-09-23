import { randomUUID } from 'node:crypto';

export const hasFreshnessTestDatabase = !!(process.env.DELIVERY_FRESHNESS_PGLITE || process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL);

/** Never uses DATABASE_URL. Native tests require an explicitly named test database
 * and create/drop only a random test schema; PGlite is entirely in-memory.
 */
export async function openFreshnessTestDatabase(): Promise<any> {
    const native = process.env.DELIVERY_FRESHNESS_TEST_DATABASE_URL;
    if (native) {
        if (!/(^|[_-])test([_-]|$)/i.test(new URL(native).pathname.slice(1))) throw new Error('Freshness integration tests require a dedicated *_test database');
        const { Client } = await import('pg');
        const client = new Client({ connectionString: native });
        const schema = `freshness_test_${randomUUID().replaceAll('-', '')}`;
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET search_path TO "${schema}"`);
        return {
            query: (sql: string, args?: unknown[]) => client.query(sql, args),
            exec: (sql: string) => client.query(sql),
            close: async () => { try { await client.query('ROLLBACK'); await client.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await client.end(); } },
        };
    }
    const path = process.env.DELIVERY_FRESHNESS_PGLITE;
    if (!path) throw new Error('Set an explicit isolated freshness test database/module');
    const { PGlite } = await import(/* @vite-ignore */ path);
    return new PGlite();
}
