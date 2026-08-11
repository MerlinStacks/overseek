/**
 * Email tracking routes for opens, clicks, and unsubscribes.
 */
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { campaignTrackingService } from '../services/CampaignTrackingService';
import { renderStorefrontStatusPage, storefrontBrandFromAccount } from './publicEmailPages';

// 1x1 transparent GIF (smallest valid GIF)
const TRANSPARENT_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

const TRUSTED_EXTERNAL_REDIRECT_HOSTS = ['auspost.com.au'];

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
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        url.searchParams.set('overseek_email_preferences', token);
        return url.toString();
    } catch {
        return null;
    }
}

async function supportsWooPreferenceCenter(wooUrl: string): Promise<boolean> {
    try {
        const healthUrl = new URL(wooUrl);
        if (healthUrl.protocol !== 'https:' && healthUrl.protocol !== 'http:') return false;
        healthUrl.pathname = `${healthUrl.pathname.replace(/\/$/, '')}/wp-json/overseek/v1/health`;
        healthUrl.search = '';
        healthUrl.hash = '';

        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) return false;
        const health = await response.json() as {
            success?: boolean;
            plugin?: string;
            capabilities?: { emailPreferenceCenter?: boolean };
            preferenceCenterReady?: boolean;
        };
        return health.success === true
            && health.plugin === 'overseek-wc'
            && health.capabilities?.emailPreferenceCenter === true
            && health.preferenceCenterReady === true;
    } catch {
        return false;
    }
}

function parseUrlEncodedBody(body: string): Record<string, string> {
    const params = new URLSearchParams(body);
    return Object.fromEntries(params.entries());
}

function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/^www\./, '');
}

function hostMatches(host: string, allowedHost: string): boolean {
    const normalizedHost = normalizeHost(host);
    const normalizedAllowed = normalizeHost(allowedHost);
    return normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`);
}

function parseAllowedHost(raw: string | null | undefined): string | null {
    if (!raw) return null;

    try {
        return new URL(raw).hostname;
    } catch {
        try {
            return new URL(`https://${raw}`).hostname;
        } catch {
            return null;
        }
    }
}

function parseConfiguredSocialUrls(appearance: unknown): string[] {
    if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) return [];

    const socialLinks = (appearance as { socialLinks?: unknown }).socialLinks;
    if (!Array.isArray(socialLinks)) return [];

    return socialLinks.flatMap((link) => {
        if (!link || typeof link !== 'object' || Array.isArray(link)) return [];
        const href = (link as { href?: unknown }).href;
        if (typeof href !== 'string') return [];

        try {
            const parsed = new URL(href);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [];
            return [parsed.toString()];
        } catch {
            return [];
        }
    });
}

function isGoogleReviewUrl(url: URL): boolean {
    return url.protocol === 'https:'
        && url.hostname.toLowerCase() === 'g.page'
        && url.port === ''
        && url.username === ''
        && url.password === ''
        && /^\/r\/[A-Za-z0-9_-]+\/review\/?$/.test(url.pathname)
        && url.search === ''
        && url.hash === '';
}

function getSafeRedirectUrl(rawUrl: string, allowedHosts: string[], allowedUrls: string[] = [], reviewRequestMarker = '1'): string | null {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return null;
        }
        const isAccountHost = allowedHosts.some(host => hostMatches(parsed.hostname, host));
        const isConfiguredUrl = allowedUrls.some(url => url === parsed.toString());
        if (!isAccountHost && !isConfiguredUrl && !isGoogleReviewUrl(parsed)) {
            return null;
        }
        return withReviewRequestMarker(parsed, reviewRequestMarker).toString();
    } catch {
        return null;
    }
}

function withReviewRequestMarker(url: URL, markerValue: string): URL {
    if (url.hash.toLowerCase() === '#review_form') {
        url.searchParams.set('overseek_review_request', markerValue || '1');
    }

    return url;
}

async function getPreferenceContext(token: string) {
    const emailLog = await prisma.emailLog.findUnique({
        where: { trackingId: token },
        include: {
            account: {
                select: {
                    name: true,
                    wooUrl: true,
                    domain: true,
                    appearance: true
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

    const requestedScope = scope === 'ALL' ? 'ALL' : 'MARKETING';
    const unsubscribeScope = context.currentScope === 'ALL' && requestedScope === 'MARKETING'
        ? 'ALL'
        : requestedScope;
    const normalizedEmail = context.emailLog.to.trim().toLowerCase();

    await prisma.$transaction(async (tx) => {
        await tx.emailUnsubscribe.deleteMany({
            where: {
                accountId: context.emailLog.accountId,
                email: { equals: normalizedEmail, mode: 'insensitive' },
                NOT: { email: normalizedEmail }
            }
        });

        await tx.emailUnsubscribe.upsert({
            where: {
                accountId_email: {
                    accountId: context.emailLog.accountId,
                    email: normalizedEmail
                }
            },
            create: {
                accountId: context.emailLog.accountId,
                email: normalizedEmail,
                scope: unsubscribeScope,
                reason: reason || null
            },
            update: {
                scope: unsubscribeScope,
                reason: reason || null
            }
        });
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
        email: normalizedEmail,
        currentScope: unsubscribeScope,
        reason: reason || null,
        updatedAt: new Date()
    };
}

async function unsubscribeFromList(token: string, listId: string) {
    const context = await getPreferenceContext(token);
    if (!context?.emailLog.sourceId || !['CAMPAIGN', 'TEST'].includes(context.emailLog.source || '')) return null;

    const campaign = await prisma.marketingCampaign.findFirst({
        where: {
            id: context.emailLog.sourceId,
            accountId: context.emailLog.accountId,
            listId
        },
        select: {
            list: { select: { id: true, name: true } }
        }
    });
    if (!campaign?.list) return null;

    const result = await prisma.emailListMember.updateMany({
        where: {
            accountId: context.emailLog.accountId,
            listId: campaign.list.id,
            email: { equals: context.email, mode: 'insensitive' },
            isSubscribed: true
        },
        data: {
            isSubscribed: false,
            unsubscribedAt: new Date(),
            source: 'EMAIL_LINK'
        }
    });

    Logger.info('Recipient unsubscribed from email list', {
        accountId: context.emailLog.accountId,
        email: context.email,
        listId: campaign.list.id,
        changed: result.count > 0
    });

    return { context, list: campaign.list };
}

function renderHostedPreferenceHtml(context: NonNullable<Awaited<ReturnType<typeof getPreferenceContext>>>) {
    const escapedEmail = escapeHtml(context.email);
    const escapedAccountName = escapeHtml(context.accountName);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Email Preferences</title>
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>
                body { margin: 0; background: #f7f4ed; color: #202020; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
                main { box-sizing: border-box; width: min(680px, calc(100% - 24px)); margin: 48px auto; padding: 34px; border: 1px solid #ded8cc; border-radius: 18px; background: #fffdf8; box-shadow: 0 18px 45px rgba(44, 36, 22, 0.08); }
                header { padding-bottom: 22px; margin-bottom: 24px; border-bottom: 1px solid #ebe5d9; }
                .eyebrow { margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #8a6b1f; }
                h1 { max-width: 520px; margin: 0 0 10px; font-size: clamp(2rem, 4vw, 3rem); line-height: 1; letter-spacing: -0.04em; }
                p { color: #5e5a52; line-height: 1.55; }
                .summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
                .summary div, .note { padding: 14px 16px; border: 1px solid #ebe5d9; border-radius: 14px; background: #faf7ef; }
                .summary span { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; color: #766f64; }
                .summary strong { word-break: break-word; }
                .note { border-color: #eadcac; background: #f8f3e6; }
                form { display: grid; gap: 10px; margin-top: 22px; }
                button { display: grid; grid-template-columns: 22px 1fr; width: 100%; padding: 17px 18px; border: 1px solid #ded8cc; border-radius: 14px; background: #ffffff; text-align: left; cursor: pointer; }
                button:hover, button:focus { border-color: #c5ad49; box-shadow: 0 10px 24px rgba(44, 36, 22, 0.08); outline: none; }
                button::before { content: ""; width: 12px; height: 12px; margin-top: 4px; border: 2px solid #b4ad9e; border-radius: 50%; }
                button strong, button span { grid-column: 2; }
                button strong { margin-bottom: 4px; font-size: 16px; }
                button span { color: #5e5a52; line-height: 1.5; }
                .footnote { margin-bottom: 0; font-size: 13px; }
                @media (max-width: 720px) { main { margin: 24px auto; padding: 24px 18px; border-radius: 14px; } .summary { grid-template-columns: 1fr; } }
            </style>
        </head>
        <body>
            <main>
                <header>
                    <p class="eyebrow">${escapedAccountName}</p>
                    <h1>Email Preferences</h1>
                    <p>Control the emails sent to ${escapedEmail}.</p>
                </header>
                <section class="summary" aria-label="Preference details">
                    <div><span>Email address</span><strong>${escapedEmail}</strong></div>
                    <div><span>Sender</span><strong>${escapedAccountName}</strong></div>
                </section>
                <p class="note">Choose what you would like to stop receiving from this sender.</p>
                <form method="POST" action="/api/email/unsubscribe/${context.emailLog.trackingId}">
                    <button type="submit" name="scope" value="MARKETING">
                        <strong>Unsubscribe from marketing</strong>
                        <span>Stop newsletters, sales campaigns, and product follow-ups. Keep receipts and important order updates.</span>
                    </button>
                    <button type="submit" name="scope" value="ALL">
                        <strong>Unsubscribe from all email</strong>
                        <span>Use this if you do not want any further email from this sender.</span>
                    </button>
                </form>
                <p class="footnote">Changes apply to this email address only.</p>
            </main>
        </body>
        </html>
    `;
}

const emailTrackingRoutes: FastifyPluginAsync = async (fastify) => {
    try {
        fastify.addContentTypeParser(
            'application/x-www-form-urlencoded',
            { parseAs: 'string' },
            (_request, body, done) => done(null, parseUrlEncodedBody(String(body || '')))
        );
    } catch (error) {
        Logger.debug('URL-encoded parser already registered for email tracking', { error });
    }

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
            let redirectUrl: string | null = null;

            try {
                const emailLog = await prisma.emailLog.findUnique({
                    where: { trackingId },
                    include: { account: { select: { name: true, wooUrl: true, domain: true, appearance: true } } }
                });

                if (!emailLog) {
                    return reply.code(404).type('text/html').send(renderStorefrontStatusPage({
                        title: 'This link is no longer available',
                        message: 'The link may have expired or the email may be out of date. Please return to the store and try again.',
                    }));
                }

                const allowedHosts = [
                    parseAllowedHost(emailLog.account?.wooUrl),
                    parseAllowedHost(emailLog.account?.domain),
                    ...TRUSTED_EXTERNAL_REDIRECT_HOSTS
                ].filter((host): host is string => Boolean(host));
                const configuredSocialUrls = parseConfiguredSocialUrls(emailLog.account?.appearance);

                redirectUrl = getSafeRedirectUrl(url, allowedHosts, configuredSocialUrls, trackingId);

                if (!redirectUrl) {
                    return reply.code(400).type('text/html').send(renderStorefrontStatusPage({
                        title: 'We couldn’t open that link',
                        message: 'The destination could not be verified, so we stopped here to keep your browsing safe.',
                        detail: 'You can still visit the store directly or contact its support team for help.',
                        brand: storefrontBrandFromAccount(emailLog.account),
                    }));
                }

                // Log click event
                await prisma.messageTrackingEvent.create({
                    data: {
                        emailLogId: emailLog.id,
                        eventType: 'CLICK',
                        linkUrl: redirectUrl,
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
                        redirectUrl
                    );
                }

                Logger.debug('Email link clicked', { trackingId, url: redirectUrl });
            } catch (error) {
                Logger.error('Click tracking error', { trackingId, error });
                if (redirectUrl) return reply.code(302).redirect(redirectUrl);
                return reply.code(500).type('text/html').send(renderStorefrontStatusPage({
                    title: 'That link needs another try',
                    message: 'We couldn’t open the page just now. Please try again in a moment.',
                }));
            }

            if (!redirectUrl) {
                return reply.code(400).type('text/html').send(renderStorefrontStatusPage({
                    title: 'We couldn’t open that link',
                    message: 'The destination could not be verified, so we stopped here to keep your browsing safe.',
                }));
            }

            // Redirect to original URL
            return reply.code(302).redirect(redirectUrl);
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
                    return reply.code(404).type('text/html').send(renderStorefrontStatusPage({
                        title: 'This link has expired',
                        message: 'This email preferences link is invalid or no longer available.',
                        detail: 'Please use the unsubscribe link in a more recent email or contact the store for help.',
                    }));
                }

                if (context.wooPreferenceCenterUrl && context.emailLog.account?.wooUrl
                    && await supportsWooPreferenceCenter(context.emailLog.account.wooUrl)) {
                    return reply.code(302).redirect(context.wooPreferenceCenterUrl);
                }

                return reply.type('text/html').send(renderHostedPreferenceHtml(context));
            } catch (error) {
                Logger.error('Unsubscribe page error', { token, error });
                return reply.code(500).type('text/html').send(renderStorefrontStatusPage({
                    title: 'We couldn’t load your preferences',
                    message: 'Your request has not been changed. Please try again in a moment.',
                }));
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
                    return reply.code(404).type('text/html').send(renderStorefrontStatusPage({
                        title: 'This link has expired',
                        message: 'We couldn’t update your preferences because this link is no longer valid.',
                    }));
                }

                return reply.type('text/html').send(renderStorefrontStatusPage({
                    kind: 'success',
                    title: 'Preferences updated',
                    message: `You have been unsubscribed from future ${updated.currentScope === 'ALL' ? 'emails' : 'marketing emails'}.`,
                    detail: 'Your changes have been saved. You can safely close this window.',
                    brand: storefrontBrandFromAccount(updated.emailLog.account),
                }));
            } catch (error) {
                Logger.error('Unsubscribe error', { token, error });
                return reply.code(500).type('text/html').send(renderStorefrontStatusPage({
                    title: 'We couldn’t save that change',
                    message: 'Your request was not completed. Please try the link again in a moment.',
                }));
            }
        }
    );

    /**
     * Remove the tracked recipient from the list targeted by this campaign.
     * GET /api/email/unsubscribe-list/:token/:listId
     */
    fastify.get<{ Params: { token: string; listId: string } }>(
        '/unsubscribe-list/:token/:listId',
        async (request, reply) => {
            const { token, listId } = request.params;

            try {
                const updated = await unsubscribeFromList(token, listId);
                if (!updated) {
                    return reply.code(404).type('text/html').send(renderStorefrontStatusPage({
                        title: 'This link has expired',
                        message: 'This mailing-list link is invalid or no longer available.',
                    }));
                }

                return reply.type('text/html').send(renderStorefrontStatusPage({
                    kind: 'success',
                    title: 'You’re unsubscribed',
                    message: `${updated.context.email} has been removed from ${updated.list.name}.`,
                    detail: 'Your other email subscriptions are unchanged. You can safely close this window.',
                    brand: storefrontBrandFromAccount(updated.context.emailLog.account),
                }));
            } catch (error) {
                Logger.error('List unsubscribe error', { token, listId, error });
                return reply.code(500).type('text/html').send(renderStorefrontStatusPage({
                    title: 'We couldn’t save that change',
                    message: 'Your request was not completed. Please try the link again in a moment.',
                }));
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
