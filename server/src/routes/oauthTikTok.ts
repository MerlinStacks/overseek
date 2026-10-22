import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuthFastify } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { PermissionService } from '../services/PermissionService';
import { TikTokMessagingService } from '../services/messaging/TikTokMessagingService';
import { buildCallbackUrl, buildFrontendUrl } from './oauthHelpers';
const DEFAULT = '/settings?tab=channels';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const secret = z.string().min(1).max(20000);
const credentialsSchema = z.object({ clientKey: secret, clientSecret: secret });
const tokensSchema = z.object({ openId: z.string().min(1).max(500), accessToken: secret, refreshToken: secret.optional(), expiresIn: z.number().int().min(1).max(366 * 86400) });
const callbackQuery = z.object({ code: z.string().min(1).max(4096).optional(), state: z.string().regex(/^[a-f0-9]{64}$/), error: z.string().max(500).optional() });
function redirectPath(value: unknown): string {
    if (value === undefined) return DEFAULT;
    if (typeof value !== 'string' || value.length > 1000 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || Array.from(value).some(character => character.charCodeAt(0) <= 32)) throw new Error('Invalid redirect');
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || !['/settings', '/marketing', '/inbox'].includes(url.pathname)) throw new Error('Invalid redirect');
    return `${url.pathname}${url.search}`;
}
const oauthTikTokRoutes: FastifyPluginAsync = async fastify => {
    fastify.get('/tiktok/authorize', { preHandler: requireAuthFastify }, async (request, reply) => {
        const accountId = request.accountId, userId = request.user?.id;
        if (!accountId || !userId) return reply.code(400).send({ error: 'Select an account' });
        if (!await PermissionService.hasPermission(userId, accountId, 'manage_channels')) return reply.code(403).send({ error: 'Channel connection permission required' });
        let path: string;
        try { path = redirectPath((request.query as Record<string, unknown>).redirect); } catch { return reply.code(400).send({ error: 'Invalid redirect path' }); }
        try {
            const platform = await prisma.platformCredentials.findUnique({ where: { platform: 'TIKTOK_MESSAGING' } });
            const credentials = credentialsSchema.safeParse(platform?.credentials);
            if (!credentials.success) return reply.code(503).send({ error: 'TikTok messaging is not configured' });
            const callbackUrl = buildCallbackUrl(request, 'tiktok/callback');
            const token = crypto.randomBytes(32).toString('hex'), browser = crypto.randomBytes(32).toString('hex');
            await prisma.oauthConnectionState.create({ data: { tokenHash: hash(token), browserHash: hash(browser), provider: 'TIKTOK_MESSAGING', userId, accountId, redirectPath: path, callbackUrl, expiresAt: new Date(Date.now() + 600000) } });
            reply.header('Set-Cookie', `oauth_tiktok_${token.slice(0, 16)}=${browser}; HttpOnly; SameSite=Lax; Path=/api/oauth/tiktok; Max-Age=600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
            const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
            url.search = new URLSearchParams({ client_key: credentials.data.clientKey, redirect_uri: callbackUrl, scope: 'user.info.basic,dm.manage', response_type: 'code', state: token }).toString();
            return { authUrl: url.toString() };
        } catch { Logger.error('TikTok authorization setup failed'); return reply.code(503).send({ error: 'Could not start TikTok connection' }); }
    });
    fastify.get('/tiktok/callback', async (request, reply) => {
        let path = DEFAULT;
        const fail = (code: string) => reply.redirect(buildFrontendUrl(path, { error: code }));
        try {
            const parsed = callbackQuery.safeParse(request.query); if (!parsed.success) return fail('invalid_state');
            const { state, code, error } = parsed.data;
            const name = `oauth_tiktok_${state.slice(0, 16)}`;
            const cookies = (request.headers.cookie || '').split(';').map(part => part.trim().split('='));
            const matches = cookies.filter(([key]) => key === name);
            const browser = matches.length === 1 ? matches[0][1] : '';
            if (!/^[a-f0-9]{64}$/.test(browser || '')) return fail('invalid_state');
            const tokenHash = hash(state);
            const grant = await prisma.oauthConnectionState.findUnique({ where: { tokenHash } });
            if (!grant || grant.provider !== 'TIKTOK_MESSAGING' || grant.browserHash !== hash(browser) || grant.consumedAt || grant.expiresAt <= new Date()) return fail('invalid_state');
            path = redirectPath(grant.redirectPath);
            const claimed = await prisma.oauthConnectionState.updateMany({ where: { tokenHash, browserHash: hash(browser), provider: 'TIKTOK_MESSAGING', consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
            if (claimed.count !== 1) return fail('invalid_state');
            reply.header('Set-Cookie', `${name}=; HttpOnly; SameSite=Lax; Path=/api/oauth/tiktok; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
            if (error) return fail('oauth_denied');
            if (!code) return fail('missing_params');
            if (!await PermissionService.hasPermission(grant.userId, grant.accountId, 'manage_channels')) return fail('permission_changed');
            const platform = await prisma.platformCredentials.findUnique({ where: { platform: 'TIKTOK_MESSAGING' } });
            const credentials = credentialsSchema.safeParse(platform?.credentials); if (!credentials.success) return fail('not_configured');
            const tokens = tokensSchema.safeParse(await TikTokMessagingService.exchangeAuthCode(code, credentials.data.clientKey, credentials.data.clientSecret, grant.callbackUrl));
            if (!tokens.success) return fail('token_exchange_failed');
            if (!await PermissionService.hasPermission(grant.userId, grant.accountId, 'manage_channels')) return fail('permission_changed');
            const value = tokens.data;
            await prisma.socialAccount.upsert({ where: { accountId_platform_externalId: { accountId: grant.accountId, platform: 'TIKTOK', externalId: value.openId } },
                create: { accountId: grant.accountId, platform: 'TIKTOK', externalId: value.openId, name: 'TikTok Business', accessToken: value.accessToken, refreshToken: value.refreshToken, tokenExpiry: new Date(Date.now() + value.expiresIn * 1000), metadata: { openId: value.openId } },
                update: { accessToken: value.accessToken, refreshToken: value.refreshToken, tokenExpiry: new Date(Date.now() + value.expiresIn * 1000), isActive: true } });
            return reply.redirect(buildFrontendUrl(path, { success: 'tiktok_connected' }));
        } catch { Logger.error('TikTok callback failed'); return fail('oauth_failed'); }
    });
};
export default oauthTikTokRoutes;
