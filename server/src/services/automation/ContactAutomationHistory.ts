import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

/** Exit nodes finish routing; they do not perform an action for the contact. */
export function hasContactAction(enrollment: {
    automation: { flowDefinition?: unknown };
    runEvents: Array<{ nodeId: string | null; outcome: string | null; metadata: unknown }>;
}): boolean {
    const flow = enrollment.automation.flowDefinition as {
        nodes?: Array<{ id: string; data?: { actionType?: string; config?: { actionType?: string } } }>;
    } | null;
    const exitIds = new Set((Array.isArray(flow?.nodes) ? flow.nodes : [])
        .filter(node => String(node.data?.config?.actionType ?? node.data?.actionType ?? '').toUpperCase() === 'EXIT')
        .map(node => node.id));

    return enrollment.runEvents.some(event => {
        const metadata = event.metadata as Record<string, unknown> | null;
        if (String(metadata?.nodeType || '').toUpperCase() !== 'ACTION') return false;
        if (String(metadata?.actionType || '').toUpperCase() === 'EXIT' || (event.nodeId && exitIds.has(event.nodeId))) return false;
        const outcome = String(event.outcome || '').toUpperCase();
        return Boolean(outcome) && !outcome.includes('SKIPPED') && !outcome.includes('FAILED')
            && outcome !== 'EMAIL_NOT_CONFIGURED';
    });
}

export async function getContactAutomationHistory(accountId: string, contactEmails: string[]) {
    const actionEvents: Prisma.AutomationRunEventWhereInput = {
        eventType: 'NODE_EXECUTED',
        OR: ['action', 'ACTION'].map(nodeType => ({ metadata: { path: ['nodeType'], equals: nodeType } })),
        NOT: [
            { outcome: { contains: 'SKIPPED', mode: 'insensitive' } },
            { outcome: { contains: 'FAILED', mode: 'insensitive' } },
            { outcome: 'EMAIL_NOT_CONFIGURED' }
        ]
    };
    const fetchPage = (cursor?: string) => prisma.automationEnrollment.findMany({
        where: {
            automation: { accountId },
            email: { in: contactEmails, mode: 'insensitive' },
            runEvents: { some: actionEvents }
        },
        include: {
            automation: { select: { name: true, flowDefinition: true } },
            runEvents: { where: actionEvents, select: { nodeId: true, outcome: true, metadata: true } }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    const visible: Awaited<ReturnType<typeof fetchPage>> = [];
    let cursor: string | undefined;
    // Apply the history limit after excluding routing-only enrollments, including
    // legacy events whose actionType must be recovered from the flow definition.
    while (visible.length < 20) {
        const page = await fetchPage(cursor);
        visible.push(...page.filter(hasContactAction));
        if (page.length < 20) break;
        cursor = page[page.length - 1].id;
    }
    return visible.slice(0, 20).map(({ runEvents, automation, ...enrollment }) => ({
        ...enrollment,
        automation: { name: automation.name }
    }));
}
