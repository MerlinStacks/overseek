import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { assertAutomationFlowCanRun } from './automation/FlowValidation';
import { canonicalFlowEmailDesigns } from './EmailDesignCompilation';

export function marketingConflict(message = 'Draft changed in another editor. Reload before saving.') {
    return Object.assign(new Error(message), { statusCode: 409 });
}

export class MarketingDraftService {
    async workspace(accountId: string, id: string) {
        const record = await prisma.marketingAutomation.findFirst({ where: { accountId, id } });
        if (!record) return null;
        return {
            ...record,
            publishedDefinition: record.flowDefinition,
            flowDefinition: record.draftDefinition ?? record.flowDefinition,
            hasUnpublishedChanges: record.draftDefinition !== null,
        };
    }

    async save(accountId: string, id: string, revision: number, flowDefinition: Prisma.InputJsonValue, name?: string) {
        const changed = await prisma.marketingAutomation.updateMany({
            where: { accountId, id, draftRevision: revision },
            data: { draftDefinition: canonicalFlowEmailDesigns(flowDefinition), draftRevision: { increment: 1 }, ...(name ? { name } : {}) },
        });
        if (!changed.count) throw marketingConflict();
        // Return the exact revision written, not a later concurrent editor's draft.
        return { id, draftRevision: revision + 1, hasUnpublishedChanges: true, ...(name ? { name } : {}) };
    }

    async publish(accountId: string, id: string, revision: number) {
        const record = await prisma.marketingAutomation.findFirst({ where: { accountId, id, draftRevision: revision } });
        if (!record) throw marketingConflict();
        const definition = (record.draftDefinition ?? record.flowDefinition) as any;
        assertAutomationFlowCanRun(definition);
        const trigger = definition.nodes.find((node: any) => String(node.type).toLowerCase() === 'trigger');
        const triggerConfig = trigger?.data?.config || trigger?.data || {};
        const publishedAt = new Date();
        const changed = await prisma.marketingAutomation.updateMany({
            where: { accountId, id, draftRevision: revision },
            data: {
                flowDefinition: definition, draftDefinition: Prisma.DbNull,
                draftRevision: { increment: 1 }, publishedAt,
                triggerType: triggerConfig.triggerType, triggerConfig,
            },
        });
        if (!changed.count) throw marketingConflict();
        return { id, draftRevision: revision + 1, hasUnpublishedChanges: false, publishedAt };
    }
}
