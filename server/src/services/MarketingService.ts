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

export class MarketingService {
    private segmentService: SegmentService;
    private emailService: EmailService;

    constructor() {
        this.segmentService = new SegmentService();
        this.emailService = new EmailService();
    }

    // -------------------
    // Campaigns (Broadcasts)
    // -------------------

    async listCampaigns(accountId: string) {
        return prisma.marketingCampaign.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' }
        });
    }

    async getCampaign(id: string, accountId: string) {
        return prisma.marketingCampaign.findFirst({
            where: { id, accountId }
        });
    }

    async createCampaign(accountId: string, data: Partial<MarketingCampaign>) {
        const segmentId = data.segmentId && data.segmentId.trim() !== '' ? data.segmentId : undefined;

        Logger.info(`Creating campaign`, { accountId, segmentId: segmentId || 'ALL' });

        return prisma.marketingCampaign.create({
            data: {
                accountId,
                name: data.name || 'Untitled Campaign',
                subject: data.subject || '',
                content: data.content || '',
                status: 'DRAFT',
                scheduledAt: data.scheduledAt,
                segmentId: segmentId
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

    async sendTestEmail(campaignId: string, email: string) {
        Logger.info(`Sending test email`, { campaignId, email });
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

        let totalRecipients = 0;

        if (campaign.segmentId) {
            totalRecipients = await this.segmentService.getSegmentCount(accountId, campaign.segmentId);
        } else {
            totalRecipients = await prisma.wooCustomer.count({
                where: { accountId, email: { not: '' } }
            });
        }

        Logger.info(`Sending Campaign`, { campaignId, recipientCount: totalRecipients, segmentId: campaign.segmentId || 'ALL' });

        await prisma.marketingCampaign.update({
            where: { id: campaignId },
            data: { status: 'SENDING', sentAt: new Date(), recipientsCount: totalRecipients }
        });

        let processedCount = 0;
        let sentCount = 0;
        let failedCount = 0;
        const BATCH_SIZE = 1000;

        const sendToBatch = async (customers: Array<{ id: string; email: string | null }>) => {
            for (const customer of customers) {
                const recipientEmail = customer.email?.trim();
                if (!recipientEmail) continue;

                processedCount++;
                try {
                    const subject = resolveMergeTags(campaign.subject, { customer });
                    const content = resolveMergeTags(campaign.content, { customer });

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
            if (campaign.segmentId) {
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

        const finalStatus = sentCount > 0 ? 'SENT' : (failedCount > 0 ? 'FAILED' : 'SENT');
        await prisma.marketingCampaign.update({
            where: { id: campaignId },
            data: { status: finalStatus, sentCount }
        });

        return { success: sentCount > 0, count: sentCount, processedCount, failedCount };
    }

    // -------------------
    // Automations
    // -------------------

    async listAutomations(accountId: string) {
        return prisma.marketingAutomation.findMany({
            where: { accountId },
            include: {
                enrollments: {
                    where: { status: 'ACTIVE' },
                    select: { id: true }
                }
            },
            orderBy: { createdAt: 'desc' }
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

        const flowDefinition = data.flowDefinition;
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
