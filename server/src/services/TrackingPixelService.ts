/**
 * Tracking Pixel Service
 * 
 * Email open tracking via transparent 1x1 pixel.
 * Privacy-respecting implementation that logs country only, not full IP.
 */

import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { randomUUID } from 'crypto';

// 1x1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

export class TrackingPixelService {
    /**
     * Generate a unique tracking ID for an email.
     */
    generateTrackingId(): string {
        return randomUUID();
    }

    /**
     * Get the transparent GIF buffer for serving.
     */
    getPixelBuffer(): Buffer {
        return TRANSPARENT_GIF;
    }

    /**
     * Record an email open event.
     * 
     * @param trackingId - The unique tracking ID from the pixel URL
     * @param ipAddress - Client IP (will be converted to country only)
     * @param userAgent - Client user agent string
     * @returns The updated EmailLog or null if tracking ID not found
     */
    async recordOpen(
        trackingId: string,
        ipAddress?: string,
        userAgent?: string
    ) {
        Logger.debug('Recording email open', { trackingId });

        // Find the email log by tracking ID
        const emailLog = await prisma.emailLog.findUnique({
            where: { trackingId },
        });

        if (!emailLog) {
            Logger.warn('Tracking ID not found', { trackingId });
            return null;
        }

        // Convert IP to country for privacy (simplified - in production use a geo-IP service)
        const ipCountry = this.ipToCountry(ipAddress);

        // Create tracking event
        await prisma.messageTrackingEvent.create({
            data: {
                emailLogId: emailLog.id,
                eventType: 'OPEN',
                ipCountry,
                userAgent: userAgent?.substring(0, 500), // Truncate long user agents
            },
        });

        // Update email log with open stats
        const isFirstOpen = !emailLog.firstOpenedAt;

        const updated = await prisma.emailLog.update({
            where: { id: emailLog.id },
            data: {
                firstOpenedAt: isFirstOpen ? new Date() : emailLog.firstOpenedAt,
                openCount: { increment: 1 },
            },
        });

        Logger.info('Email open recorded', {
            emailLogId: emailLog.id,
            isFirstOpen,
            openCount: updated.openCount,
        });

        return updated;
    }

    /**
     * Get tracking statistics for an email.
     */
    async getTrackingStats(emailLogId: string) {
        const emailLog = await prisma.emailLog.findUnique({
            where: { id: emailLogId },
            include: {
                trackingEvents: {
                    orderBy: { createdAt: 'desc' },
                    take: 10, // Last 10 events
                },
            },
        });

        if (!emailLog) {
            return null;
        }

        return {
            firstOpenedAt: emailLog.firstOpenedAt,
            openCount: emailLog.openCount,
            recentEvents: emailLog.trackingEvents,
        };
    }

    /**
     * Check if an email has been opened.
     */
    async isOpened(trackingId: string): Promise<boolean> {
        const emailLog = await prisma.emailLog.findUnique({
            where: { trackingId },
            select: { firstOpenedAt: true },
        });

        return emailLog?.firstOpenedAt != null;
    }

    /**
     * Convert IP address to country code.
     * Simplified implementation - in production, use a geo-IP service like MaxMind.
     */
    private ipToCountry(ipAddress?: string): string | null {
        if (!ipAddress) return null;

        // In production, integrate with a geo-IP service:
        // const geo = geoip.lookup(ipAddress);
        // return geo?.country || null;

        // For now, return null (privacy-preserving default)
        return null;
    }

    /**
     * Generate tracking pixel HTML for embedding in emails.
     */
    generatePixelHtml(trackingId: string, baseUrl: string): string {
        const pixelUrl = `${baseUrl}/api/email/track/${trackingId}.png`;
        return `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;
    }
}
