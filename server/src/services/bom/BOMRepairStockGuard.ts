import { prisma } from '../../utils/prisma';

/** Repair derived availability only; never supersede pending receipt/deduction work. */
export async function assertBOMRepairStockInputs(accountId: string, ownerWooIds: number[]) {
    const owners = [...new Set(ownerWooIds.filter(id => Number.isSafeInteger(id) && id > 0))];
    const [operation, legacy, account] = await Promise.all([
        prisma.receiptOperation.findFirst({ where: { accountId, stockOwnerWooId: { in: owners }, OR: [
            { state: { notIn: ['applied', 'reconciled'] } }, { cascadeState: { not: 'done' } }
        ] }, select: { operationId: true } }),
        // Legacy work can have an unknown target set. Do not guess that an
        // unrelated-looking cached mapping proves it cannot affect this repair.
        prisma.receiptLegacyWork.findFirst({ where: { accountId, state: { not: 'drained' } }, select: { id: true } }),
        prisma.receiptAccount.findFirst({ where: { accountId, OR: [
            { receivingFrozen: true }, { cascadeLeaseExpiresAt: { gt: new Date() } }
        ] }, select: { accountId: true } })
    ]);
    if (operation || legacy || account) throw new Error('BOM_REPAIR_STOCK_UNSETTLED');
}
