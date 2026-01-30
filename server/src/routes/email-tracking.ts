/**
 * Email tracking routes for opens, clicks, and unsubscribes.
 */
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { campaignTrackingService } from '../services/CampaignTrackingService';

// 1x1 transparent GIF (smallest valid GIF)
const TRANSPARENT_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

const emailTrackingRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * Track email opens via invisible pixel.
     * GET /api/email/track/:id.png
     */
    fastify.get<{ Params: { id: string } }>(
        '/track/:id.png',
        {
            schema: {
                params: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    required: ['id']
                }
            }
        },
        async (request, reply) => {
            const { id } = request.params;

            try {
                const emailLog = await prisma.emailLog.findUnique({
                    where: { trackingId: id }
                });

                if (emailLog) {
                    const now = new Date();

                    await prisma.emailLog.update({
                        where: { id: emailLog.id },
                        data: {
                            firstOpenedAt: emailLog.firstOpenedAt ?? now,
                            openCount: { increment: 1 }
                        }
                    });

                    await prisma.messageTrackingEvent.create({
                        data: {
                            emailLogId: emailLog.id,
                            eventType: 'OPEN',
                            userAgent: request.headers['user-agent'] || null,
                            ipCountry: null
                        }
                    });

                    // Track for campaign analytics
                    if (emailLog.sourceId) {
                        await campaignTrackingService.trackOpen(
                            emailLog.accountId,
                            emailLog.sourceId,
                            emailLog.to
                        );
                    }

                    Logger.debug('Email opened', { trackingId: id, to: emailLog.to });
                }
            } catch (error) {
                Logger.error('Email tracking error', { trackingId: id, error });
            }

            return reply
                .header('Content-Type', 'image/gif')
                .header('Cache-Control', 'no-cache, no-store, must-revalidate')
                .send(TRANSPARENT_GIF);
        }
    );

    /**
     * Track email link clicks.
     * GET /api/email/click/:trackingId
     * Query: url (encoded destination URL)
     */
    fastify.get<{ Params: { trackingId: string }; Querystring: { url: string } }>(
        '/click/:trackingId',
        {
            schema: {
                params: {
                    type: 'object',
                    properties: { trackingId: { type: 'string' } },
                    required: ['trackingId']
                },
                querystring: {
                    type: 'object',
                    properties: { url: { type: 'string' } },
                    required: ['url']
                }
            }
        },
        async (request, reply) => {
            const { trackingId } = request.params;
            const { url } = request.query;

            try {
                const emailLog = await prisma.emailLog.findUnique({
                    where: { trackingId }
                });

                if (emailLog) {
                    // Log click event
                    await prisma.messageTrackingEvent.create({
                        data: {
                            emailLogId: emailLog.id,
                            eventType: 'CLICK',
                            linkUrl: url,
                            userAgent: request.headers['user-agent'] || null,
                            ipCountry: null
                        }
                    });

                    // Track for campaign analytics
                    if (emailLog.sourceId) {
                        await campaignTrackingService.trackClick(
                            emailLog.accountId,
                            emailLog.sourceId,
                            emailLog.to,
                            url
                        );
                    }

                    Logger.debug('Email link clicked', { trackingId, url });
                }
            } catch (error) {
                Logger.error('Click tracking error', { trackingId, error });
            }

            // Redirect to original URL
            return reply.code(302).redirect(url);
        }
    );

    /**
     * Show unsubscribe confirmation page.
     * GET /api/email/unsubscribe/:token
     */
    fastify.get<{ Params: { token: string } }>(
        '/unsubscribe/:token',
        async (request, reply) => {
            const { token } = request.params;

            try {
                const emailLog = await prisma.emailLog.findUnique({
                    where: { trackingId: token },
                    include: { account: { select: { name: true } } }
                });

                if (!emailLog) {
                    return reply.code(404).type('text/html').send(`
                        <!DOCTYPE html>
                        <html><head><title>Invalid Link</title></head>
                        <body style="font-family: system-ui; padding: 40px; text-align: center;">
                            <h1>Invalid Unsubscribe Link</h1>
                            <p>This unsubscribe link is invalid or has expired.</p>
                        </body></html>
                    `);
                }

                const accountName = emailLog.account?.name || 'this sender';

                return reply.type('text/html').send(`
                    <!DOCTYPE html>
                    <html><head><title>Unsubscribe</title></head>
                    <body style="font-family: system-ui; padding: 40px; text-align: center; max-width: 500px; margin: 0 auto;">
                        <h1>Unsubscribe</h1>
                        <p>You are about to unsubscribe <strong>${emailLog.to}</strong> from emails sent by <strong>${accountName}</strong>.</p>
                        <form method="POST" action="/api/email/unsubscribe/${token}">
                            <button type="submit" style="background: #dc2626; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer;">
                                Confirm Unsubscribe
                            </button>
                        </form>
                        <p style="margin-top: 20px; color: #666; font-size: 14px;">Changed your mind? Just close this page.</p>
                    </body></html>
                `);
            } catch (error) {
                Logger.error('Unsubscribe page error', { token, error });
                return reply.code(500).send('An error occurred');
            }
        }
    );

    /**
     * Process unsubscribe request.
     * POST /api/email/unsubscribe/:token
     */
    fastify.post<{ Params: { token: string }; Body: { reason?: string } }>(
        '/unsubscribe/:token',
        async (request, reply) => {
            const { token } = request.params;
            const { reason } = request.body || {};

            try {
                const emailLog = await prisma.emailLog.findUnique({
                    where: { trackingId: token }
                });

                if (!emailLog) {
                    return reply.code(404).send({ error: 'Invalid token' });
                }

                // Create unsubscribe record
                await prisma.emailUnsubscribe.upsert({
                    where: {
                        accountId_email: {
                            accountId: emailLog.accountId,
                            email: emailLog.to
                        }
                    },
                    create: {
                        accountId: emailLog.accountId,
                        email: emailLog.to,
                        reason: reason || null
                    },
                    update: {
                        reason: reason || null
                    }
                });

                // Track unsubscribe event
                if (emailLog.sourceId) {
                    await campaignTrackingService.trackEvent({
                        accountId: emailLog.accountId,
                        campaignId: emailLog.sourceId,
                        eventType: 'unsubscribe',
                        recipientEmail: emailLog.to
                    });
                }

                Logger.info('Email unsubscribed', { email: emailLog.to, accountId: emailLog.accountId });

                return reply.type('text/html').send(`
                    <!DOCTYPE html>
                    <html><head><title>Unsubscribed</title></head>
                    <body style="font-family: system-ui; padding: 40px; text-align: center;">
                        <h1>✓ Successfully Unsubscribed</h1>
                        <p>You have been unsubscribed from future emails.</p>
                        <p style="color: #666; font-size: 14px;">You may close this window.</p>
                    </body></html>
                `);
            } catch (error) {
                Logger.error('Unsubscribe error', { token, error });
                return reply.code(500).send({ error: 'Failed to unsubscribe' });
            }
        }
    );
};

export default emailTrackingRoutes;

