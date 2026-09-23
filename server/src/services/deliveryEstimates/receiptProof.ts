import { Prisma } from '@prisma/client';

export type ReceiptProof = { version: 1; epoch: string; owners: { stockOwnerWooId: number; sequence: number; operationId: string }[] };
/** Caller holds the delivery Account lock throughout projection and decoration. No baseline inference. */
export async function attachReceiptProof<T extends { receiptSafety: string; targets: { stockOwnerWooId: number | null; state: string }[] }>(
    tx: Prisma.TransactionClient, accountId: string, payload: T,
): Promise<Omit<T, 'receiptSafety'> & { receiptSafety: 'unverified' | 'verified'; receiptProof?: ReceiptProof }> {
    const unverified = { ...payload, receiptSafety: 'unverified' as const };
    const control = await tx.receiptAccount.findUnique({ where: { accountId } });
    if (!control?.cutoverEpoch || control.cutoverState !== 'guarded') return unverified;
    const ids = [...new Set(payload.targets.filter(t => t.state === 'pending').map(t => t.stockOwnerWooId).filter((id): id is number => id !== null))].sort((a, b) => a - b);
    if (!ids.length) return unverified;
    const owners = await tx.receiptOwner.findMany({ where: { accountId, stockOwnerWooId: { in: ids } } });
    const proof: ReceiptProof = { version: 1, epoch: control.cutoverEpoch, owners: [] };
    for (const id of ids) {
        const owner = owners.find(o => o.stockOwnerWooId === id);
        if (!owner || owner.certifiedEpoch !== control.cutoverEpoch || owner.parked || owner.cascadePending || owner.lastSequence !== owner.appliedSequence || owner.appliedSequence > BigInt(Number.MAX_SAFE_INTEGER)) return unverified;
        const operation = owner.appliedSequence === 0n ? null : await tx.receiptOperation.findUnique({ where: { accountId_stockOwnerWooId_sequence: { accountId, stockOwnerWooId: id, sequence: owner.appliedSequence } } });
        if (owner.appliedSequence > 0n && (!operation || !['applied', 'reconciled'].includes(operation.state) || operation.cascadeState !== 'done')) return unverified;
        proof.owners.push({ stockOwnerWooId: id, sequence: Number(owner.appliedSequence), operationId: operation?.operationId ?? `baseline_${control.cutoverEpoch}` });
    }
    return { ...payload, receiptSafety: 'verified', receiptProof: proof };
}
