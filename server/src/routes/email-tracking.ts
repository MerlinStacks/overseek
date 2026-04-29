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

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getWooPreferenceCenterUrl(wooUrl: string | null | undefined, token: string): string | null {
    if (!wooUrl) return null;

    try {
        const url = new URL(wooUrl);
        url.searchParams.set('overseek_email_preferences', token);
        return url.toString();
    } catch {
        return null;
    }
}

async function getPreferenceContext(token: string) {
    const emailLog = await prisma.emailLog.findUnique({
        where: { trackingId: token },
        include: {
            account: {
                select: {
                    name: true,
                    wooUrl: true
                }
            }
        }
    });

    if (!emailLog) {
        return null;
    }

    const unsubscribe = await prisma.emailUnsubscribe.findFirst({
        where: {
            accountId: emailLog.accountId,
            email: { equals: emailLog.to, mode: 'insensitive' }
        },
        select: {
            scope: true,
            reason: true,
            createdAt: true
        }
    });

    return {
        emailLog,
        email: emailLog.to,
        accountName: emailLog.account?.name || 'this sender',
        wooPreferenceCenterUrl: getWooPreferenceCenterUrl(emailLog.account?.wooUrl, token),
        currentScope: unsubscribe?.scope || 'NONE',
        reason: unsubscribe?.reason || null,
        updatedAt: unsubscribe?.createdAt || null
    };
}

async function upsertPreference(token: string, scope?: string, reason?: string) {
    const context = await getPreferenceContext(token);
    if (!context) {
        return null;
    }

    const unsubscribeScope = scope === 'ALL' ? 'ALL' : 'MARKETING';

    await prisma.emailUnsubscribe.upsert({
        where: {
            accountId_email: {
                accountId: context.emailLog.accountId,
                email: context.emailLog.to
            }
        },
        create: {
            accountId: context.emailLog.accountId,
            email: context.emailLog.to,
            scope: unsubscribeScope,
            reason: reason || null
        },
        update: {
            scope: unsubscribeScope,
            reason: reason || null
        }
    });

    if (context.emailLog.sourceId) {
        await campaignTrackingService.trackEvent({
            accountId: context.emailLog.accountId,
            campaignId: context.emailLog.sourceId,
            eventType: 'unsubscribe',
            recipientEmail: context.emailLog.to
        });
    }

    Logger.info('Email preferences updated', {
        email: context.emailLog.to,
        accountId: context.emailLog.accountId,
        scope: unsubscribeScope
    });

    return {
        ...context,
        currentScope: unsubscribeScope,
        reason: reason || null,
        updatedAt: new Date()
    };
}

function renderHostedPreferenceHtml(context: NonNullable<Awaited<ReturnType<typeof getPreferenceContext>>>) {
    const escapedEmail = escapeHtml(context.email);
    const escapedAccountName = escapeHtml(context.accountName);

    return `
        <!DOCTYPE html>
        <html><head><title>Email Preferences</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center; max-width: 500px; margin: 0 auto;">
            <h1>Email Preferences</h1>
            <p><strong>${escapedEmail}</strong> is receiving emails from <strong>${escapedAccountName}</strong>.</p>
            <p style="color: #555;">Choose whether to stop marketing emails only, or stop all email from this sender.</p>
            <form method="POST" action="/api/email/unsubscribe/${context.emailLog.trackingId}" style="display: grid; gap: 12px; margin-top: 24px;">
                <button type="submit" name="scope" value="MARKETING" style="background: #dc2626; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer;">
                    Unsubscribe From Marketing Emails
                </button>
                <button type="submit" name="scope" value="ALL" style="background: #111827; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer;">
                    Unsubscribe From All Emails
                </button>
            </form>
            <p style="margin-top: 20px; color: #666; font-size: 14px;">Order receipts and other important updates can continue if you only opt out of marketing.</p>
        </body></html>
    `;
}

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
                const context = await getPreferenceContext(token);

                if (!context) {
                    return reply.code(404).type('text/html').send(`
                        <!DOCTYPE html>
                        <html><head><title>Invalid Link</title></head>
                        <body style="font-family: system-ui; padding: 40px; text-align: center;">
                            <h1>Invalid Unsubscribe Link</h1>
                            <p>This unsubscribe link is invalid or has expired.</p>
                        </body></html>
                    `);
                }

                if (context.wooPreferenceCenterUrl) {
                    return reply.redirect(context.wooPreferenceCenterUrl);
                }

                return reply.type('text/html').send(renderHostedPreferenceHtml(context));
            } catch (error) {
                Logger.error('Unsubscribe page error', { token, error });
                return reply.code(500).send('An error occurred');
            }
        }
    );

    fastify.get<{ Params: { token: string } }>(
        '/preferences/:token',
        async (request, reply) => {
            const { token } = request.params;

            try {
                const context = await getPreferenceContext(token);

                if (!context) {
                    return reply.code(404).send({ error: 'Invalid token' });
                }

                return reply.send({
                    email: context.email,
                    accountName: context.accountName,
                    currentScope: context.currentScope,
                    reason: context.reason,
                    updatedAt: context.updatedAt,
                    preferenceCenterUrl: context.wooPreferenceCenterUrl
                });
            } catch (error) {
                Logger.error('Preference lookup error', { token, error });
                return reply.code(500).send({ error: 'Failed to load preferences' });
            }
        }
    );

    /**
     * Process unsubscribe request.
     * POST /api/email/unsubscribe/:token
     */
    fastify.post<{ Params: { token: string }; Body: { reason?: string; scope?: string } }>(
        '/unsubscribe/:token',
        async (request, reply) => {
            const { token } = request.params;
            const { reason, scope } = request.body || {};

            try {
                const updated = await upsertPreference(token, scope, reason);

                if (!updated) {
                    return reply.code(404).send({ error: 'Invalid token' });
                }

                return reply.type('text/html').send(`
                    <!DOCTYPE html>
                    <html><head><title>Unsubscribed</title></head>
                    <body style="font-family: system-ui; padding: 40px; text-align: center;">
                        <h1>✓ Preferences Updated</h1>
                        <p>You have been unsubscribed from future ${updated.currentScope === 'ALL' ? 'emails' : 'marketing emails'}.</p>
                        <p style="color: #666; font-size: 14px;">You may close this window.</p>
                    </body></html>
                `);
            } catch (error) {
                Logger.error('Unsubscribe error', { token, error });
                return reply.code(500).send({ error: 'Failed to unsubscribe' });
            }
        }
    );

    fastify.post<{ Params: { token: string }; Body: { reason?: string; scope?: string } }>(
        '/preferences/:token',
        async (request, reply) => {
            const { token } = request.params;
            const { reason, scope } = request.body || {};

            try {
                const updated = await upsertPreference(token, scope, reason);

                if (!updated) {
                    return reply.code(404).send({ error: 'Invalid token' });
                }

                return reply.send({
                    success: true,
                    email: updated.email,
                    accountName: updated.accountName,
                    currentScope: updated.currentScope,
                    reason: updated.reason,
                    updatedAt: updated.updatedAt
                });
            } catch (error) {
                Logger.error('Preference update error', { token, error });
                return reply.code(500).send({ error: 'Failed to update preferences' });
            }
        }
    );
};

export default emailTrackingRoutes;

