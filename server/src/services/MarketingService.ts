/**
 * Marketing Service
 * 
 * Manages marketing campaigns, automations, and email templates.
 * Merge tag resolution delegated to MergeTagResolver.
 */

import { MarketingCampaign, MarketingAutomation, EmailTemplate } from '@prisma/client';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { SegmentService } from './SegmentService';
import { resolveMergeTags } from './MergeTagResolver';

export class MarketingService {
    private segmentService: SegmentService;

    constructor() {
        this.segmentService = new SegmentService();
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
        const BATCH_SIZE = 1000;

        try {
            if (campaign.segmentId) {
                for await (const batch of this.segmentService.iterateCustomersInSegment(accountId, campaign.segmentId, BATCH_SIZE)) {
                    processedCount += batch.length;
                }
            } else {
                let cursor: string | undefined;
                while (true) {
                    const params: any = {
                        where: { accountId, email: { not: '' } },
                        select: { id: true, email: true },
                        take: BATCH_SIZE,
                        orderBy: { id: 'asc' }
                    };

                    if (cursor) {
                        params.cursor = { id: cursor };
                        params.skip = 1;
                    }

                    const customers = await prisma.wooCustomer.findMany(params);
                    if (customers.length === 0) break;

                    processedCount += customers.length;

                    if (customers.length < BATCH_SIZE) break;
                    cursor = customers[customers.length - 1].id;
                }
            }
        } catch (err) {
            Logger.error('Error sending campaign', err);
        }

        await prisma.marketingCampaign.update({
            where: { id: campaignId },
            data: { status: 'SENT', sentCount: processedCount }
        });

        return { success: true, count: processedCount };
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
        const { id, name, triggerType, triggerConfig, steps, isActive } = data;

        if (id) {
            return prisma.marketingAutomation.update({
                where: { id },
                data: {
                    name,
                    triggerType,
                    triggerConfig,
                    isActive,
                    flowDefinition: data.flowDefinition,
                    status: isActive ? 'ACTIVE' : 'PAUSED'
                }
            });
        }

        return prisma.marketingAutomation.create({
            data: {
                accountId,
                name,
                triggerType,
                triggerConfig,
                isActive: isActive || false,
                flowDefinition: data.flowDefinition,
                status: isActive ? 'ACTIVE' : 'PAUSED'
            }
        });
    }

    async deleteAutomation(id: string, accountId: string) {
        return prisma.marketingAutomation.deleteMany({ where: { id, accountId } });
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
