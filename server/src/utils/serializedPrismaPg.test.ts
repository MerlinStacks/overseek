import { expect, it, vi } from 'vitest';
import { serializePgTransaction } from './serializedPrismaPg';
type Transaction = Parameters<typeof serializePgTransaction>[0];
const sql = (text: string) => ({ sql: text, args: [], argTypes: [] });
function fixture() {
    let active = 0, maxActive = 0;
    const order: string[] = [], releases: Array<() => void> = [];
    const io = async (text: string) => {
        active++; maxActive = Math.max(maxActive, active); order.push(text);
        try { await new Promise<void>(resolve => releases.push(resolve)); }
        finally { active--; }
        if (text === 'FAIL') throw new Error('original database failure');
    };
    const transaction: Transaction = {
        provider: 'postgres', adapterName: 'test', options: { usePhantomQuery: false },
        async queryRaw(query) { await io(query.sql); return { rows: [], columnNames: [], columnTypes: [] }; },
        async executeRaw(query) { await io(query.sql); return 1; },
        async commit() { await io('release:commit'); },
        async rollback() { await io('release:rollback'); },
        async createSavepoint(name) { await this.executeRaw(sql(`SAVEPOINT ${name}`)); },
        async rollbackToSavepoint(name) { await this.executeRaw(sql(`ROLLBACK TO SAVEPOINT ${name}`)); },
        async releaseSavepoint(name) { await this.executeRaw(sql(`RELEASE SAVEPOINT ${name}`)); },
    };
    return { transaction, order, releases, maxActive: () => maxActive };
}
it('serializes overlapping query/execute calls and releases only after pending IO', async () => {
    const f = fixture(), tx = serializePgTransaction(f.transaction);
    const work = [tx.queryRaw(sql('SELECT 1')), tx.executeRaw(sql('UPDATE example')), tx.queryRaw(sql('SELECT 2')), tx.commit()];
    await vi.waitFor(() => expect(f.order).toEqual(['SELECT 1']));
    f.releases.shift()!(); await vi.waitFor(() => expect(f.order).toEqual(['SELECT 1', 'UPDATE example']));
    f.releases.shift()!(); await vi.waitFor(() => expect(f.order.at(-1)).toBe('SELECT 2'));
    f.releases.shift()!(); await vi.waitFor(() => expect(f.order.at(-1)).toBe('release:commit'));
    f.releases.shift()!(); await Promise.all(work);
    expect(f.maxActive()).toBe(1);
});
it('preserves the original query failure and still drains rollback without retrying', async () => {
    const f = fixture(), tx = serializePgTransaction(f.transaction);
    const failed = tx.queryRaw(sql('FAIL'));
    const assertion = expect(failed).rejects.toThrow('original database failure');
    const rolledBack = tx.rollback();
    await vi.waitFor(() => expect(f.order).toEqual(['FAIL'])); f.releases.shift()!();
    await vi.waitFor(() => expect(f.order).toEqual(['FAIL', 'release:rollback'])); f.releases.shift()!();
    await assertion; await rolledBack; expect(f.maxActive()).toBe(1);
});
it('does not serialize independent transaction connections globally', async () => {
    const a = fixture(), b = fixture();
    const work = [serializePgTransaction(a.transaction).queryRaw(sql('a')), serializePgTransaction(b.transaction).queryRaw(sql('b'))];
    await vi.waitFor(() => { expect(a.order).toEqual(['a']); expect(b.order).toEqual(['b']); });
    a.releases.shift()!(); b.releases.shift()!(); await Promise.all(work);
});
it('routes savepoint IO through the same sequence without nested-queue deadlocks', async () => {
    const f = fixture(), tx = serializePgTransaction(f.transaction);
    const work = [tx.createSavepoint!('point'), tx.queryRaw(sql('SELECT 1')), tx.rollbackToSavepoint!('point'), tx.releaseSavepoint!('point')];
    for (const text of ['SAVEPOINT point', 'SELECT 1', 'ROLLBACK TO SAVEPOINT point', 'RELEASE SAVEPOINT point']) {
        await vi.waitFor(() => expect(f.order.at(-1)).toBe(text)); f.releases.shift()!();
    }
    await Promise.all(work); expect(f.maxActive()).toBe(1);
});
it('rejects late queries after closing begins rather than executing on a released pooled connection', async () => {
    const f = fixture(), tx = serializePgTransaction(f.transaction);
    const commit = tx.commit();
    await expect(tx.queryRaw(sql('LATE'))).rejects.toThrow('already closing');
    await vi.waitFor(() => expect(f.order).toEqual(['release:commit']));
    f.releases.shift()!(); await commit;
    await expect(tx.executeRaw(sql('LATER'))).rejects.toThrow('already closing');
    await expect(tx.rollback()).rejects.toThrow('already closing');
    expect(f.order).toEqual(['release:commit']);
});
