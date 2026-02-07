/**
 * Audience Sync Service
 * 
 * Orchestrates synchronization of customer segments to ad platform audiences.
 * Supports Meta Custom Audiences and Google Customer Match.
 * Part of AI Co-Pilot v2 - Phase 2: Audience Intelligence.
 */

import { prisma } from '../../utils/prisma';
import { Logger } from '../../utils/logger';
import { segmentService } from '../SegmentService';
import { MetaAdsService } from './MetaAdsService';
import { GoogleAdsService } from './GoogleAdsService';


export interface AudienceSyncResult {
    id: string;
    status: 'SYNCED' | 'FAILED';
    externalId?: string;
    memberCount?: number;
    error?: string;
}

export interface CreateAudienceOptions {
    accountId: string;
    segmentId: string;
    adAccountId: string;
    audienceName?: string;  // Optional custom name, defaults to segment name
}

export interface LookalikeOptions {
    audienceSyncId: string;
    percent: 1 | 3 | 5;
    countryCode?: string;  // Default: 'US'
}


export class AudienceSyncService {

    /**
     * Sync a customer segment to a Meta Custom Audience.
     * Creates the audience if new, or updates members if existing.
     */
    static async syncSegmentToMeta(options: CreateAudienceOptions): Promise<AudienceSyncResult> {
        const { accountId, segmentId, adAccountId, audienceName } = options;

        Logger.info('[AudienceSync] Starting Meta sync', { accountId, segmentId, adAccountId });

        // Get segment details
        const segment = await segmentService.getSegment(segmentId, accountId);
        if (!segment) {
            throw new Error('Segment not found');
        }

        const finalName = audienceName || `OverSeek: ${segment.name}`;

        // Check if sync record exists
        let audienceSync = await prisma.audienceSync.findFirst({
            where: {
                accountId,
                segmentId,
                adAccountId,
                platform: 'META'
            }
        });

        try {
            // Get exportable customer data
            const customerData = await segmentService.getExportableCustomers(accountId, segmentId);

            if (customerData.hashedEmails.length === 0) {
                throw new Error('No valid customer emails in segment');
            }

            // Update status to syncing
            if (audienceSync) {
                await prisma.audienceSync.update({
                    where: { id: audienceSync.id },
                    data: { status: 'SYNCING', lastError: null }
                });
            } else {
                audienceSync = await prisma.audienceSync.create({
                    data: {
                        accountId,
                        segmentId,
                        adAccountId,
                        platform: 'META',
                        audienceName: finalName,
                        status: 'SYNCING'
                    }
                });
            }

            let externalId = audienceSync.externalId;

            // Create audience if it doesn't exist
            if (!externalId) {
                const createResult = await MetaAdsService.createCustomAudience(
                    adAccountId,
                    finalName,
                    `Synced from OverSeek segment: ${segment.name}`
                );
                externalId = createResult.id;
            }

            // Upload members (replace existing)
            const uploadResult = await MetaAdsService.replaceCustomAudienceMembers(
                adAccountId,
                externalId,
                customerData.hashedEmails
            );

            // Update sync record
            await prisma.audienceSync.update({
                where: { id: audienceSync.id },
                data: {
                    status: 'SYNCED',
                    externalId,
                    memberCount: uploadResult.numReceived,
                    lastSyncAt: new Date(),
                    lastError: null
                }
            });

            Logger.info('[AudienceSync] Meta sync complete', {
                audienceSyncId: audienceSync.id,
                externalId,
                memberCount: uploadResult.numReceived
            });

            return {
                id: audienceSync.id,
                status: 'SYNCED',
                externalId,
                memberCount: uploadResult.numReceived
            };

        } catch (error: any) {
            Logger.error('[AudienceSync] Meta sync failed', { error: error.message, segmentId });

            if (audienceSync) {
                await prisma.audienceSync.update({
                    where: { id: audienceSync.id },
                    data: {
                        status: 'FAILED',
                        lastError: error.message
                    }
                });
            }

            return {
                id: audienceSync?.id || '',
                status: 'FAILED',
                error: error.message
            };
        }
    }

    /**
     * Sync a customer segment to a Google Customer Match User List.
     * Creates the list if new, or updates members if existing.
     */
    static async syncSegmentToGoogle(options: CreateAudienceOptions): Promise<AudienceSyncResult> {
        const { accountId, segmentId, adAccountId, audienceName } = options;

        Logger.info('[AudienceSync] Starting Google sync', { accountId, segmentId, adAccountId });

        // Get segment details
        const segment = await segmentService.getSegment(segmentId, accountId);
        if (!segment) {
            throw new Error('Segment not found');
        }

        const finalName = audienceName || `OverSeek: ${segment.name}`;

        // Check if sync record exists
        let audienceSync = await prisma.audienceSync.findFirst({
            where: {
                accountId,
                segmentId,
                adAccountId,
                platform: 'GOOGLE'
            }
        });

        try {
            // Get exportable customer data
            const customerData = await segmentService.getExportableCustomers(accountId, segmentId);

            if (customerData.hashedEmails.length === 0) {
                throw new Error('No valid customer emails in segment');
            }

            // Update status to syncing
            if (audienceSync) {
                await prisma.audienceSync.update({
                    where: { id: audienceSync.id },
                    data: { status: 'SYNCING', lastError: null }
                });
            } else {
                audienceSync = await prisma.audienceSync.create({
                    data: {
                        accountId,
                        segmentId,
                        adAccountId,
                        platform: 'GOOGLE',
                        audienceName: finalName,
                        status: 'SYNCING'
                    }
                });
            }

            let externalId = audienceSync.externalId;

            // Create user list if it doesn't exist
            if (!externalId) {
                const createResult = await GoogleAdsService.createUserList(
                    adAccountId,
                    finalName,
                    `Synced from OverSeek segment: ${segment.name}`
                );
                externalId = createResult.resourceName;
            }

            // Upload members (replace existing)
            const uploadResult = await GoogleAdsService.replaceUserListMembers(
                adAccountId,
                externalId,
                customerData.hashedEmails
            );

            // Update sync record
            await prisma.audienceSync.update({
                where: { id: audienceSync.id },
                data: {
                    status: 'SYNCED',
                    externalId,
                    memberCount: uploadResult.uploadedCount,
                    lastSyncAt: new Date(),
                    lastError: null
                }
            });

            Logger.info('[AudienceSync] Google sync complete', {
                audienceSyncId: audienceSync.id,
                externalId,
                memberCount: uploadResult.uploadedCount
            });

            return {
                id: audienceSync.id,
                status: 'SYNCED',
                externalId,
                memberCount: uploadResult.uploadedCount
            };

        } catch (error: any) {
            Logger.error('[AudienceSync] Google sync failed', { error: error.message, segmentId });

            if (audienceSync) {
                await prisma.audienceSync.update({
                    where: { id: audienceSync.id },
                    data: {
                        status: 'FAILED',
                        lastError: error.message
                    }
                });
            }

            return {
                id: audienceSync?.id || '',
                status: 'FAILED',
                error: error.message
            };
        }
    }

    /**
     * Refresh an existing synced audience with updated segment members.
     */
    static async refreshAudience(audienceSyncId: string): Promise<AudienceSyncResult> {
        const audienceSync = await prisma.audienceSync.findUnique({
            where: { id: audienceSyncId }
        });

        if (!audienceSync) {
            throw new Error('Audience sync not found');
        }

        if (!audienceSync.externalId) {
            throw new Error('Audience has not been synced yet');
        }

        if (audienceSync.platform === 'META') {
            return this.syncSegmentToMeta({
                accountId: audienceSync.accountId,
                segmentId: audienceSync.segmentId,
                adAccountId: audienceSync.adAccountId,
                audienceName: audienceSync.audienceName
            });
        } else if (audienceSync.platform === 'GOOGLE') {
            return this.syncSegmentToGoogle({
                accountId: audienceSync.accountId,
                segmentId: audienceSync.segmentId,
                adAccountId: audienceSync.adAccountId,
                audienceName: audienceSync.audienceName
            });
        }

        throw new Error(`Unknown platform: ${audienceSync.platform}`);
    }

    /**
     * Create a lookalike audience from an existing synced audience.
     */
    static async createLookalike(options: LookalikeOptions): Promise<AudienceSyncResult> {
        const { audienceSyncId, percent, countryCode = 'US' } = options;

        const sourceAudience = await prisma.audienceSync.findUnique({
            where: { id: audienceSyncId },
            include: { segment: true }
        });

        if (!sourceAudience) {
            throw new Error('Source audience not found');
        }

        if (!sourceAudience.externalId) {
            throw new Error('Source audience has not been synced yet');
        }

        const lookalikeNameSuffix = `${percent}% Lookalike`;
        const lookalikeAudienceName = `${sourceAudience.audienceName} - ${lookalikeNameSuffix}`;

        try {
            let externalId: string;

            if (sourceAudience.platform === 'META') {
                const result = await MetaAdsService.createLookalikeAudience(
                    sourceAudience.adAccountId,
                    sourceAudience.externalId,
                    lookalikeAudienceName,
                    percent,
                    countryCode
                );
                externalId = result.id;
            } else if (sourceAudience.platform === 'GOOGLE') {
                // Google Similar Audiences are auto-created by the platform
                // We track them separately but don't create them directly
                const result = await GoogleAdsService.createSimilarAudience(
                    sourceAudience.adAccountId,
                    sourceAudience.externalId,
                    lookalikeAudienceName
                );
                externalId = result.resourceName;
            } else {
                throw new Error(`Unknown platform: ${sourceAudience.platform}`);
            }

            // Create lookalike sync record
            const lookalikeSync = await prisma.audienceSync.create({
                data: {
                    accountId: sourceAudience.accountId,
                    segmentId: sourceAudience.segmentId,
                    adAccountId: sourceAudience.adAccountId,
                    platform: sourceAudience.platform,
                    audienceName: lookalikeAudienceName,
                    externalId,
                    status: 'SYNCED',
                    isLookalike: true,
                    sourceAudienceId: sourceAudience.id,
                    lookalikePercent: percent,
                    lastSyncAt: new Date()
                }
            });

            Logger.info('[AudienceSync] Lookalike created', {
                sourceId: audienceSyncId,
                lookalikeId: lookalikeSync.id,
                percent
            });

            return {
                id: lookalikeSync.id,
                status: 'SYNCED',
                externalId
            };

        } catch (error: any) {
            Logger.error('[AudienceSync] Lookalike creation failed', { error: error.message });
            return {
                id: '',
                status: 'FAILED',
                error: error.message
            };
        }
    }

    /**
     * Get all audience syncs for an account.
     */
    static async getAudienceSyncs(accountId: string) {
        return prisma.audienceSync.findMany({
            where: { accountId },
            include: {
                segment: { select: { name: true } },
                adAccount: { select: { name: true, platform: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    /**
     * Get a specific audience sync with details.
     */
    static async getAudienceSync(audienceSyncId: string) {
        return prisma.audienceSync.findUnique({
            where: { id: audienceSyncId },
            include: {
                segment: { select: { name: true, criteria: true } },
                adAccount: { select: { name: true, platform: true } }
            }
        });
    }

    /**
     * Delete an audience sync (and optionally the platform audience).
     */
    static async deleteAudienceSync(audienceSyncId: string, deleteFromPlatform = false): Promise<void> {
        const audienceSync = await prisma.audienceSync.findUnique({
            where: { id: audienceSyncId }
        });

        if (!audienceSync) {
            throw new Error('Audience sync not found');
        }

        // Delete from platform if requested
        if (deleteFromPlatform && audienceSync.externalId) {
            try {
                if (audienceSync.platform === 'META') {
                    await MetaAdsService.deleteCustomAudience(
                        audienceSync.adAccountId,
                        audienceSync.externalId
                    );
                } else if (audienceSync.platform === 'GOOGLE') {
                    await GoogleAdsService.deleteUserList(
                        audienceSync.adAccountId,
                        audienceSync.externalId
                    );
                }
            } catch (error: any) {
                Logger.warn('[AudienceSync] Failed to delete from platform', { error: error.message });
            }
        }

        // Delete local record
        await prisma.audienceSync.delete({
            where: { id: audienceSyncId }
        });

        Logger.info('[AudienceSync] Deleted', { audienceSyncId, deletedFromPlatform: deleteFromPlatform });
    }

    /**
     * Refresh all synced audiences for an account.
     * Called by scheduled job.
     */
    static async refreshAllAudiences(accountId: string): Promise<{ refreshed: number; failed: number }> {
        const audiences = await prisma.audienceSync.findMany({
            where: {
                accountId,
                status: 'SYNCED',
                isLookalike: false,  // Only refresh source audiences
                externalId: { not: null }
            }
        });

        let refreshed = 0;
        let failed = 0;

        for (const audience of audiences) {
            try {
                const result = await this.refreshAudience(audience.id);
                if (result.status === 'SYNCED') {
                    refreshed++;
                } else {
                    failed++;
                }
            } catch {
                failed++;
            }
        }

        Logger.info('[AudienceSync] Bulk refresh complete', { accountId, refreshed, failed });

        return { refreshed, failed };
    }
}

export default AudienceSyncService;
