import { PrismaPg } from '@prisma/adapter-pg';

type PgAdapter = Awaited<ReturnType<PrismaPg['connect']>>;
type PgTransaction = Awaited<ReturnType<PgAdapter['startTransaction']>>;

/** One pg transaction owns one physical connection. pg 8.22 deprecates its
 * implicit query queue, so sequence adapter IO without serializing the pool. */
export function serializePgTransaction(transaction: PgTransaction): PgTransaction {
    let tail: Promise<void> = Promise.resolve();
    let closing = false;
    const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
        const result = tail.then(work);
        // Rollback must still run after a rejected query; callers retain the
        // original rejection, and no query is retried or error converted.
        tail = result.then(() => undefined, () => undefined);
        return result;
    };
    const queryRaw = transaction.queryRaw.bind(transaction);
    const executeRaw = transaction.executeRaw.bind(transaction);
    const commit = transaction.commit.bind(transaction);
    const rollback = transaction.rollback.bind(transaction);
    const enqueueQuery = <T>(work: () => Promise<T>) => closing
        ? Promise.reject(new Error('Transaction is already closing; no more queries may use its connection'))
        : enqueue(work);
    const close = (work: () => Promise<void>) => {
        if (closing) return Promise.reject(new Error('Transaction is already closing'));
        closing = true;
        return enqueue(work);
    };
    transaction.queryRaw = query => enqueueQuery(() => queryRaw(query));
    transaction.executeRaw = query => enqueueQuery(() => executeRaw(query));
    transaction.commit = () => close(commit);
    transaction.rollback = () => close(rollback);
    // Savepoint methods call this.executeRaw, which now uses the same queue.
    // Queuing those outer methods too would deadlock their nested executeRaw.
    return transaction;
}

function serializeAdapterTransactions(adapter: PgAdapter): PgAdapter {
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async isolationLevel => serializePgTransaction(await startTransaction(isolationLevel));
    return adapter;
}

/** Wrap only public adapter methods, not pg internals or application queries. */
export class SerializedPrismaPg extends PrismaPg {
    async connect(): Promise<PgAdapter> {
        return serializeAdapterTransactions(await super.connect());
    }

    async connectToShadowDb(): Promise<PgAdapter> {
        return serializeAdapterTransactions(await super.connectToShadowDb());
    }
}
