/**
 * Marketing Service
 * 
 * Manages marketing campaigns, automations, and email templates.
 * Merge tag resolution delegated to MergeTagResolver.
 */

import { MarketingCampaign } from '@prisma/client';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { SegmentService } from './SegmentService';
import { resolveMergeTags } from './MergeTagResolver';
import { EmailService } from './EmailService';
import { getDefaultEmailAccount } from '../utils/getDefaultEmailAccount';
import { campaignTrackingService } from './CampaignTrackingService';
import { automationAnalyticsService } from './AutomationAnalyticsService';
import { QueueFactory, QUEUES } from './queue/QueueFactory';

export class MarketingService {
    private segmentService: SegmentService;
    private emailService: EmailService;

    constructor() {
        this.segmentService = new SegmentService();
        this.emailService = new EmailService();
    }

    private normalizeFlowDefinition(flowDefinition: any) {
        if (!flowDefinition || !Array.isArray(flowDefinition.nodes)) {
            return flowDefinition;
        }

        const allowedDelayUnits = new Set(['minutes', 'hours', 'days', 'weeks', 'months']);
        let didNormalize = false;

        const nodes = flowDefinition.nodes.map((node: any) => {
            if (String(node?.type).toLowerCase() !== 'delay') {
                return node;
            }

            const config = node?.data?.config || node?.data || {};
            const durationRaw = config.duration;
            const duration = typeof durationRaw === 'number' ? durationRaw : Number(durationRaw);
            const normalizedDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
            const unitRaw = String(config.unit || 'hours').toLowerCase();
            const normalizedUnit = allowedDelayUnits.has(unitRaw) ? unitRaw : 'hours';

            if (normalizedDuration === duration && normalizedUnit === unitRaw) {
                return node;
            }

            didNormalize = true;
            return {
                ...node,
                data: {
                    ...(node?.data || {}),
                    config: {
                        ...config,
                        duration: normalizedDuration,
                        unit: normalizedUnit
                    }
                }
            };
        });

        if (didNormalize) {
            Logger.warn('[MarketingService] Normalized invalid delay node config before saving automation flow');
        }

        return {
            ...flowDefinition,
            nodes
        };
    }

    // -------------------
    // Campaigns (Broadcasts)
    // -------------------

    async listCampaigns(accountId: string) {
        const campaigns = await prisma.marketingCampaign.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' }
        });

        if (campaigns.length === 0) return campaigns;

        const campaignIds = campaigns.map((campaign) => campaign.id);
        const [statusGroups, latestLogPerCampaign] = await Promise.all([
            prisma.emailLog.groupBy({
                by: ['sourceId', 'status'],
                where: {
                    accountId,
                    source: 'CAMPAIGN',
                    sourceId: { in: campaignIds }
                },
                _count: true
            }),
            prisma.emailLog.findMany({
                where: {
                    accountId,
                    source: 'CAMPAIGN',
                    sourceId: { in: campaignIds }
                },
                orderBy: { createdAt: 'desc' },
                select: {
                    sourceId: true,
                    createdAt: true
                }
            })
        ]);

        const groupedCounts = new Map<string, { processed: number; sent: number; failed: number; skipped: number }>();
        for (const group of statusGroups) {
            const sourceId = group.sourceId;
            if (!sourceId) continue;

            const current = groupedCounts.get(sourceId) || { processed: 0, sent: 0, failed: 0, skipped: 0 };
            const count = group._count;
            current.processed += count;
            if (group.status === 'SUCCESS' || group.status === 'RETRIED') current.sent += count;
            if (group.status === 'FAILED') current.failed += count;
            if (group.status === 'SKIPPED') current.skipped += count;
            groupedCounts.set(sourceId, current);
        }

        const latestByCampaign = new Map<string, Date>();
        for (const item of latestLogPerCampaign) {
            if (!item.sourceId || latestByCampaign.has(item.sourceId)) continue;
            latestByCampaign.set(item.sourceId, item.createdAt);
        }

        return campaigns.map((campaign) => {
            const progress = groupedCounts.get(campaign.id) || { processed: 0, sent: 0, failed: 0, skipped: 0 };
            return {
                ...campaign,
                progress: {
                    processedCount: progress.processed,
                    sentCount: progress.sent,
                    failedCount: progress.failed,
                    skippedCount: progress.skipped,
                    lastEventAt: latestByCampaign.get(campaign.id) || null
                }
            };
        });
    }

    async getCampaign(id: string, accountId: string) {
        return prisma.marketingCampaign.findFirst({
            where: { id, accountId }
        });
    }

    async createCampaign(accountId: string, data: Partial<MarketingCampaign>) {
        const segmentId = data.segmentId && data.segmentId.trim() !== '' ? data.segmentId : undefined;
        const listId = (data as any).listId && (data as any).listId.trim() !== '' ? (data as any).listId : undefined;

        Logger.info(`Creating campaign`, { accountId, segmentId: segmentId || 'ALL', listId: listId || 'NONE' });

        return prisma.marketingCampaign.create({
            data: {
                accountId,
                name: data.name || 'Untitled Campaign',
                subject: data.subject || '',
                content: data.content || '',
                status: 'DRAFT',
                scheduledAt: data.scheduledAt,
                segmentId: segmentId,
                listId
            }
        });
    }

    async updateCampaign(id: string, accountId: string, data: Partial<MarketingCampaign>) {
        const { id: _, accountId: __, createdAt: ___, ...updateData } = data;
        return prisma.marketingCampaign.updateMany({
            where: { id, accountId },
            data: { ...(updateData as any), updatedAt: new Date() }
        });
    }

    async deleteCampaign(id: string, accountId: string) {
        return prisma.marketingCampaign.deleteMany({ where: { id, accountId } });
    }

    async sendTestEmail(campaignId: string, accountId: string, email: string) {
        const recipientEmail = email?.trim();
        if (!recipientEmail || !/^\S+@\S+\.\S+$/.test(recipientEmail)) {
            throw new Error('Valid test email is required');
        }

        const campaign = await this.getCampaign(campaignId, accountId);
        if (!campaign) throw new Error('Campaign not found');
        if (!campaign.subject?.trim() || !campaign.content?.trim()) {
            throw new Error('Campaign must have subject and content before testing');
        }

        const defaultEmailAccount = await getDefaultEmailAccount(accountId);
        if (!defaultEmailAccount) {
            throw new Error('No sending-capable email account is configured');
        }

        const account = await prisma.account?.findFirst({
            where: { id: accountId },
            select: { wooUrl: true, domain: true }
        });
        const storeUrl = account?.wooUrl || account?.domain || '';
        const normalizedStoreUrl = storeUrl.startsWith('http://') || storeUrl.startsWith('https://')
            ? storeUrl
            : (storeUrl ? `https://${storeUrl}` : '');
        const context = {
            customer: {
                firstName: 'Test',
                lastName: 'Customer',
                email: recipientEmail
            },
            store: { url: normalizedStoreUrl },
            storeUrl: normalizedStoreUrl,
            store_url: normalizedStoreUrl,
            preferencesUrl: normalizedStoreUrl ? `${normalizedStoreUrl.replace(/\/$/, '')}/my-account/edit-account/` : '',
            unsubscribeUrl: normalizedStoreUrl ? `${normalizedStoreUrl.replace(/\/$/, '')}/?unsubscribe=1` : ''
        };

        const result = await this.emailService.sendEmail(
            accountId,
            defaultEmailAccount.id,
            recipientEmail,
            resolveMergeTags(campaign.subject, context),
            resolveMergeTags(campaign.content, context),
            undefined,
            { source: 'TEST', sourceId: campaignId, category: 'MARKETING' }
        );

        if (result && typeof result === 'object' && 'skipped' in result && result.skipped) {
            return { success: false, skipped: true, reason: 'reason' in result ? result.reason : 'email_skipped' };
        }

        Logger.info(`Sent campaign test email`, { campaignId, accountId, email: recipientEmail });
        return { success: true };
    }

    async sendCampaign(campaignId: string, accountId: string) {
        const campaign = await this.getCampaign(campaignId, accountId);
        if (!campaign) throw new Error('Campaign not found');
        if (!campaign.subject?.trim() || !campaign.content?.trim()) {
            throw new Error('Campaign must have subject and content before sending');
        }

        const defaultEmailAccount = await getDefaultEmailAccount(accountId);
        if (!defaultEmailAccount) {
            throw new Error('No sending-capable email account is configured');
        }

        const account = await prisma.account?.findFirst({
            where: { id: accountId },
            select: { wooUrl: true, domain: true }
        });
        const storeUrl = account?.wooUrl || account?.domain || '';

        let totalRecipients = 0;

        if ((campaign as any).listId) {
            totalRecipients = await prisma.emailListMember.count({
                where: {
                    accountId,
                    listId: (campaign as any).listId,
                    isSubscribed: true
                }
            });
        } else if (campaign.segmentId) {
            totalRecipients = await this.segmentService.getSegmentCount(accountId, campaign.segmentId);
        } else {
            totalRecipients = await prisma.wooCustomer.count({
                where: { accountId, email: { not: '' } }
            });
        }

        Logger.info(`Sending Campaign`, {
            campaignId,
            recipientCount: totalRecipients,
            segmentId: campaign.segmentId || 'ALL',
            listId: (campaign as any).listId || 'NONE'
        });

        await prisma.marketingCampaign.update({
            where: { id: campaignId },
            data: { status: 'SENDING', sentAt: new Date(), recipientsCount: totalRecipients }
        });

        let processedCount = 0;
        let sentCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        const BATCH_SIZE = 1000;

        const sendToBatch = async (customers: Array<{ id: string; email: string | null; firstName?: string | null; lastName?: string | null }>) => {
            for (const customer of customers) {
                const recipientEmail = customer.email?.trim();
                if (!recipientEmail) continue;

                processedCount++;
                try {
                    const subject = resolveMergeTags(campaign.subject, {
                        customer,
                        store: { url: storeUrl }
                    });
                    const content = resolveMergeTags(campaign.content, {
                        customer,
                        store: { url: storeUrl }
                    });

                    const result = await this.emailService.sendEmail(
                        accountId,
                        defaultEmailAccount.id,
                        recipientEmail,
                        subject,
                        content,
                        undefined,
                        { source: 'CAMPAIGN', sourceId: campaignId }
                    );

                    if (result && typeof result === 'object' && 'skipped' in result && result.skipped) {
                        skippedCount++;
                        continue;
                    }

                    sentCount++;
                    await campaignTrackingService.trackSend(accountId, campaignId, 'broadcast', recipientEmail);
                } catch (error) {
                    failedCount++;
                    Logger.error('Error sending campaign email', {
                        campaignId,
                        accountId,
                        recipientEmail,
                        error
                    });
                }
            }
        };

        try {
            if ((campaign as any).listId) {
                let cursor: string | undefined;
                while (true) {
                    const memberships = await prisma.emailListMember.findMany({
                        where: {
                            accountId,
                            listId: (campaign as any).listId,
                            isSubscribed: true,
                            email: { not: '' }
                        },
                        select: { id: true, email: true },
                        orderBy: { id: 'asc' },
                        take: BATCH_SIZE,
                        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
                    });

                    if (memberships.length === 0) break;
                    await sendToBatch(memberships.map((m) => ({ id: m.id, email: m.email })));

                    if (memberships.length < BATCH_SIZE) break;
                    cursor = memberships[memberships.length - 1].id;
                }
            } else if (campaign.segmentId) {
                for await (const batch of this.segmentService.iterateCustomersInSegment(accountId, campaign.segmentId, BATCH_SIZE)) {
                    await sendToBatch(batch);
                }
            } else {
                let cursor: string | undefined;
                while (true) {
                    const params: any = {
                        where: { accountId, email: { not: '' } },
                        select: { id: true, email: true, firstName: true, lastName: true },
                        take: BATCH_SIZE,
                        orderBy: { id: 'asc' }
                    };

                    if (cursor) {
                        params.cursor = { id: cursor };
                        params.skip = 1;
                    }

                    const customers = await prisma.wooCustomer.findMany(params);
                    if (customers.length === 0) break;

                    await sendToBatch(customers);

                    if (customers.length < BATCH_SIZE) break;
                    cursor = customers[customers.length - 1].id;
                }
            }
        } catch (err) {
            Logger.error('Error sending campaign', err);
        }

        const finalStatus = sentCount > 0 ? 'SENT' : 'FAILED';
        await prisma.marketingCampaign.update({
            where: { id: campaignId },
            data: { status: finalStatus, sentCount }
        });

        return { success: sentCount > 0, count: sentCount, processedCount, failedCount, skippedCount };
    }

    private getScheduledCampaignJobId(campaignId: string) {
        return `campaign-scheduled:${campaignId}`;
    }

    private async removeScheduledCampaignJob(campaignId: string) {
        const queue = QueueFactory.getQueue(QUEUES.CAMPAIGNS);
        const scheduledJob = await queue.getJob(this.getScheduledCampaignJobId(campaignId));
        if (scheduledJob) {
            await scheduledJob.remove();
        }
    }

    async scheduleCampaign(campaignId: string, accountId: string, scheduledAt: Date) {
        const campaign = await this.getCampaign(campaignId, accountId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        if (campaign.status === 'SENT') {
            throw new Error('Campaign already sent');
        }

        if (!campaign.subject?.trim() || !campaign.content?.trim()) {
            throw new Error('Campaign must have subject and content before scheduling');
        }

        const delayMs = scheduledAt.getTime() - Date.now();
        if (!Number.isFinite(delayMs) || delayMs <= 0) {
            throw new Error('Scheduled time must be in the future');
        }

        await this.removeScheduledCampaignJob(campaignId);

        await prisma.marketingCampaign.updateMany({
            where: {
                id: campaignId,
                accountId,
                status: { in: ['DRAFT', 'FAILED', 'SCHEDULED'] }
            },
            data: {
                status: 'SCHEDULED',
                scheduledAt
            }
        });

        const queue = QueueFactory.getQueue(QUEUES.CAMPAIGNS);
        await queue.add(
            QUEUES.CAMPAIGNS,
            { accountId, campaignId },
            {
                jobId: this.getScheduledCampaignJobId(campaignId),
                delay: delayMs,
                removeOnComplete: 100,
                removeOnFail: 500,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 }
            }
        );

        return { scheduled: true, scheduledAt };
    }

    async unscheduleCampaign(campaignId: string, accountId: string) {
        const campaign = await this.getCampaign(campaignId, accountId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        if (campaign.status !== 'SCHEDULED') {
            return { unscheduled: false, reason: 'not_scheduled' as const };
        }

        await this.removeScheduledCampaignJob(campaignId);

        await prisma.marketingCampaign.updateMany({
            where: { id: campaignId, accountId, status: 'SCHEDULED' },
            data: { status: 'DRAFT', scheduledAt: null }
        });

        return { unscheduled: true };
    }

    async enqueueCampaignSend(campaignId: string, accountId: string) {
        const campaign = await this.getCampaign(campaignId, accountId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        if (campaign.status === 'SENDING') {
            return { queued: false, reason: 'already_sending' as const };
        }

        if (campaign.status === 'SENT') {
            return { queued: false, reason: 'already_sent' as const };
        }

        const lock = await prisma.marketingCampaign.updateMany({
            where: {
                id: campaignId,
                accountId,
                status: { in: ['DRAFT', 'FAILED', 'SCHEDULED'] }
            },
            data: { status: 'SENDING', scheduledAt: null }
        });

        if (lock.count === 0) {
            return { queued: false, reason: 'invalid_status' as const };
        }

        const queue = QueueFactory.getQueue(QUEUES.CAMPAIGNS);
        const jobId = `campaign-send:${campaignId}:${Date.now()}`;

        try {
            await this.removeScheduledCampaignJob(campaignId);
            await queue.add(
                QUEUES.CAMPAIGNS,
                { accountId, campaignId },
                {
                    jobId,
                    removeOnComplete: 100,
                    removeOnFail: 500,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 5000 }
                }
            );
        } catch (error) {
            await prisma.marketingCampaign.updateMany({
                where: { id: campaignId, accountId, status: 'SENDING' },
                data: { status: campaign.status === 'FAILED' ? 'FAILED' : 'DRAFT' }
            });
            throw error;
        }

        return { queued: true, jobId };
    }

    // -------------------
    // Automations
    // -------------------

    async listAutomations(accountId: string) {
        const automations = await prisma.marketingAutomation.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' }
        });

        if (automations.length === 0) {
            return [];
        }

        const automationIds = automations.map((automation) => automation.id);

        const now = new Date();
        const [enrollmentGroups, holdingGroups, completedActionEvents, failedActionEvents, goalGroups] = await Promise.all([
            prisma.automationEnrollment.groupBy({
                by: ['automationId', 'status'],
                where: {
                    accountId,
                    automationId: { in: automationIds }
                },
                _count: true
            }),
            prisma.automationEnrollment.groupBy({
                by: ['automationId'],
                where: {
                    accountId,
                    automationId: { in: automationIds },
                    status: 'ACTIVE',
                    nextRunAt: { gt: now }
                },
                _count: true
            }),
            prisma.automationRunEvent.findMany({
                where: {
                    accountId,
                    automationId: { in: automationIds },
                    eventType: 'NODE_EXECUTED',
                    enrollment: { status: 'COMPLETED' },
                    NOT: { outcome: { contains: 'SKIPPED', mode: 'insensitive' } }
                },
                select: {
                    automationId: true,
                    enrollmentId: true,
                    metadata: true
                }
            }),
            prisma.automationRunEvent.findMany({
                where: {
                    accountId,
                    automationId: { in: automationIds },
                    eventType: 'NODE_EXECUTED',
                    outcome: { contains: 'FAILED', mode: 'insensitive' },
                    NOT: { outcome: { contains: 'SKIPPED', mode: 'insensitive' } }
                },
                select: {
                    automationId: true,
                    enrollmentId: true,
                    metadata: true
                }
            }),
            prisma.automationGoalEvent.groupBy({
                by: ['automationId'],
                where: {
                    accountId,
                    automationId: { in: automationIds }
                },
                _sum: { revenue: true }
            })
        ]);

        const enrollmentStats = new Map<string, { active: number; completed: number }>();
        for (const group of enrollmentGroups) {
            const existing = enrollmentStats.get(group.automationId) || { active: 0, completed: 0 };
            if (group.status === 'ACTIVE') existing.active = group._count;
            enrollmentStats.set(group.automationId, existing);
        }

        const holdingStats = new Map<string, number>();
        for (const group of holdingGroups) {
            holdingStats.set(group.automationId, group._count);
        }

        const completedEnrollmentIdsByAutomation = new Map<string, Set<string>>();
        for (const event of completedActionEvents) {
            const metadata = (event.metadata && typeof event.metadata === 'object') ? event.metadata as Record<string, unknown> : {};
            if (String(metadata.nodeType || '').toUpperCase() === 'TRIGGER') continue;

            const enrollmentIds = completedEnrollmentIdsByAutomation.get(event.automationId) || new Set<string>();
            enrollmentIds.add(event.enrollmentId);
            completedEnrollmentIdsByAutomation.set(event.automationId, enrollmentIds);
        }

        for (const [automationId, enrollmentIds] of completedEnrollmentIdsByAutomation) {
            const existing = enrollmentStats.get(automationId) || { active: 0, completed: 0 };
            existing.completed = enrollmentIds.size;
            enrollmentStats.set(automationId, existing);
        }

        const failedEnrollmentIdsByAutomation = new Map<string, Set<string>>();
        for (const event of failedActionEvents) {
            const metadata = (event.metadata && typeof event.metadata === 'object') ? event.metadata as Record<string, unknown> : {};
            if (String(metadata.nodeType || '').toUpperCase() === 'TRIGGER') continue;

            const enrollmentIds = failedEnrollmentIdsByAutomation.get(event.automationId) || new Set<string>();
            enrollmentIds.add(event.enrollmentId);
            failedEnrollmentIdsByAutomation.set(event.automationId, enrollmentIds);
        }

        const failedStats = new Map<string, number>();
        for (const [automationId, enrollmentIds] of failedEnrollmentIdsByAutomation) {
            failedStats.set(automationId, enrollmentIds.size);
        }

        const revenueStats = new Map<string, number>();
        for (const group of goalGroups) {
            revenueStats.set(group.automationId, Number(group._sum.revenue || 0));
        }

        return automations.map((automation) => {
            const enrollment = enrollmentStats.get(automation.id) || { active: 0, completed: 0 };
            return {
                ...automation,
                metrics: {
                    activeInFlow: enrollment.active,
                    pausedInFlow: holdingStats.get(automation.id) || 0,
                    completedInFlow: enrollment.completed,
                    failedInFlow: failedStats.get(automation.id) || 0,
                    revenue: revenueStats.get(automation.id) || 0
                }
            };
        });
    }

    async getAutomation(id: string, accountId: string) {
        return prisma.marketingAutomation.findFirst({
            where: { id, accountId },
            include: { steps: { orderBy: { stepOrder: 'asc' } } }
        });
    }

    async upsertAutomation(accountId: string, data: any) {
        const { id, name, triggerType, triggerConfig, isActive } = data;

        const flowDefinition = this.normalizeFlowDefinition(data.flowDefinition);
        const triggerNode = flowDefinition?.nodes?.find((node: any) => {
            const nodeType = String(node?.type || '').toUpperCase();
            return nodeType === 'TRIGGER';
        });
        const triggerNodeConfig = triggerNode?.data?.config || triggerNode?.data || {};
        const resolvedTriggerType =
            triggerType
            && String(triggerType).trim() !== ''
            && String(triggerType).toUpperCase() !== 'NONE'
                ? triggerType
                : (triggerNodeConfig.triggerType || triggerType || 'NONE');
        const resolvedTriggerConfig =
            triggerConfig
            || triggerNodeConfig
            || {};

        if (id) {
            const existing = await prisma.marketingAutomation.findFirst({
                where: { id, accountId },
                select: {
                    id: true,
                    name: true,
                    triggerType: true,
                    triggerConfig: true,
                    flowDefinition: true,
                    isActive: true
                }
            });
            if (!existing) {
                throw new Error('Automation not found');
            }

            const nextIsActive =
                typeof isActive === 'boolean'
                    ? isActive
                    : existing.isActive;

            return prisma.marketingAutomation.update({
                where: { id },
                data: {
                    name: name || existing.name,
                    triggerType: resolvedTriggerType || existing.triggerType,
                    triggerConfig: resolvedTriggerConfig || existing.triggerConfig,
                    isActive: nextIsActive,
                    flowDefinition: flowDefinition || existing.flowDefinition,
                    status: nextIsActive ? 'ACTIVE' : 'PAUSED'
                }
            });
        }

        const nextIsActive = Boolean(isActive);
        return prisma.marketingAutomation.create({
            data: {
                accountId,
                name: name || 'Untitled Flow',
                triggerType: resolvedTriggerType || 'NONE',
                triggerConfig: resolvedTriggerConfig,
                isActive: nextIsActive,
                flowDefinition: flowDefinition || { nodes: [], edges: [] },
                status: nextIsActive ? 'ACTIVE' : 'PAUSED'
            }
        });
    }

    async deleteAutomation(id: string, accountId: string) {
        return prisma.marketingAutomation.deleteMany({ where: { id, accountId } });
    }

    async setAutomationEnabled(id: string, accountId: string, isActive: boolean) {
        const automation = await prisma.marketingAutomation.findFirst({
            where: { id, accountId },
            select: { id: true }
        });

        if (!automation) {
            throw new Error('Automation not found');
        }

        return prisma.marketingAutomation.update({
            where: { id },
            data: {
                isActive,
                status: isActive ? 'ACTIVE' : 'PAUSED'
            }
        });
    }

    async getAutomationAnalytics(id: string, accountId: string) {
        const automation = await prisma.marketingAutomation.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!automation) {
            throw new Error('Automation not found');
        }
        return automationAnalyticsService.getAutomationAnalytics(accountId, id);
    }

    async listAutomationEnrollments(id: string, accountId: string, limit = 50) {
        const automation = await prisma.marketingAutomation.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!automation) {
            throw new Error('Automation not found');
        }
        return automationAnalyticsService.listEnrollments(accountId, id, limit);
    }

    async listAutomationRunEvents(id: string, accountId: string, limit = 50) {
        const automation = await prisma.marketingAutomation.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!automation) {
            throw new Error('Automation not found');
        }
        return automationAnalyticsService.listRunEvents(accountId, id, limit);
    }

    async getAutomationNodeAnalytics(id: string, accountId: string, nodeId: string, status = 'completed', page = 1, perPage = 10) {
        const automation = await prisma.marketingAutomation.findFirst({
            where: { id, accountId },
            select: { id: true, flowDefinition: true }
        });
        if (!automation) {
            throw new Error('Automation not found');
        }
        if (!this.automationHasNode(automation.flowDefinition, nodeId)) {
            throw new Error('Node not found');
        }
        return automationAnalyticsService.getNodeAnalytics(accountId, id, nodeId, status, page, perPage);
    }

    async getAutomationEnrollmentJourney(id: string, accountId: string, enrollmentId: string) {
        const enrollment = await prisma.automationEnrollment.findFirst({
            where: { id: enrollmentId, automationId: id, accountId },
            select: { id: true }
        });
        if (!enrollment) {
            throw new Error('Enrollment not found');
        }
        return automationAnalyticsService.getEnrollmentJourney(accountId, id, enrollmentId);
    }

    async getAutomationNodeStats(id: string, accountId: string, nodeIds?: string[]) {
        const automation = await prisma.marketingAutomation.findFirst({
            where: { id, accountId },
            select: { id: true }
        });
        if (!automation) {
            throw new Error('Automation not found');
        }
        return automationAnalyticsService.getNodeStats(accountId, id, nodeIds);
    }

    private automationHasNode(flowDefinition: unknown, nodeId: string): boolean {
        const nodes = (flowDefinition as { nodes?: Array<{ id?: unknown }> } | null)?.nodes;
        return Array.isArray(nodes) && nodes.some((node) => node.id === nodeId);
    }

    // -------------------
    // Templates
    // -------------------

    async listTemplates(accountId: string) {
        return prisma.emailTemplate.findMany({
            where: { accountId },
            orderBy: { updatedAt: 'desc' }
        });
    }

    async upsertTemplate(accountId: string, data: any) {
        const { id, name, subject, content, designJson } = data;

        if (id) {
            const existing = await prisma.emailTemplate.findFirst({
                where: { id, accountId },
                select: { id: true }
            });
            if (!existing) {
                throw new Error('Template not found');
            }

            return prisma.emailTemplate.update({
                where: { id },
                data: { name, subject, content, designJson }
            });
        }

        return prisma.emailTemplate.create({
            data: { accountId, name, subject, content, designJson }
        });
    }

    async deleteTemplate(id: string, accountId: string) {
        return prisma.emailTemplate.deleteMany({ where: { id, accountId } });
    }

    // Delegate merge tag resolution to MergeTagResolver
    resolveWooCommerceMergeTags = resolveMergeTags;
}
