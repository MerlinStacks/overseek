import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { PermissionService } from '../services/PermissionService';

function origin(value: string | undefined, development: string): string {
    if (!value && process.env.NODE_ENV === 'production') throw new Error('Public OAuth origin is not configured');
    const url = new URL(value?.trim() || development);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid public OAuth origin');
    return url.origin;
}
export function getApiBase(_request: FastifyRequest): string { return origin(process.env.API_URL, 'http://localhost:3000'); }
export function getAppUrl(): string { return origin(process.env.APP_URL, 'http://localhost:5173'); }
export function buildCallbackUrl(request: FastifyRequest, suffix: string): string {
    if (!/^[a-z]+(?:-[a-z]+)*(?:\/[a-z]+(?:-[a-z]+)*)*$/.test(suffix)) throw new Error('Invalid callback path');
    return `${getApiBase(request)}/api/oauth/${suffix}`;
}
export function relativeOauthRedirect(path: string): string {
    if (typeof path !== 'string' || path.length > 1000 || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || Array.from(path).some(c => c.charCodeAt(0) <= 32)) throw new Error('Invalid redirect');
    const url = new URL(path, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid') throw new Error('Invalid redirect');
    return `${url.pathname}${url.search}${url.hash}`;
}
export function buildFrontendUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(relativeOauthRedirect(path), getAppUrl());
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
}
const payloadSchema = z.object({ accountId: z.string().min(1).max(200), userId: z.string().min(1).max(200), frontendRedirect: z.string().transform(relativeOauthRedirect),
    reconnectId: z.string().min(1).max(200).optional(), provider: z.enum(['GOOGLE_ADS', 'META_ADS', 'META_MESSAGING', 'SEARCH_CONSOLE']), callbackUrl: z.string().url().max(2000) }).strict();
type Payload = z.infer<typeof payloadSchema>;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const cookieName = (token: string) => `oauth_shared_${token.slice(0, 16)}`;
function cookie(reply: FastifyReply, token: string, browser: string, age: number) {
    reply.header('Set-Cookie', `${cookieName(token)}=${browser}; HttpOnly; SameSite=Lax; Path=/api/oauth; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
export async function assertOauthPermission(userId: string, accountId: string, provider: string) {
    if (!await PermissionService.hasPermission(userId, accountId, provider === 'META_MESSAGING' ? 'manage_channels' : 'manage_marketing')) throw new Error('Connection permission required');
}
/** Name retained for callers; state is now opaque, durable and browser-bound, not a signed tenant assertion. */
export async function createSignedOauthState(input: Payload, reply: FastifyReply): Promise<string> {
    const payload = payloadSchema.parse(input);
    await assertOauthPermission(payload.userId, payload.accountId, payload.provider);
    if (payload.reconnectId && !await prisma.adAccount.findFirst({ where: { id: payload.reconnectId, accountId: payload.accountId, platform: payload.provider === 'GOOGLE_ADS' ? 'GOOGLE' : 'META' }, select: { id: true } })) throw new Error('Invalid reconnection target');
    const token = crypto.randomBytes(32).toString('hex'), browser = crypto.randomBytes(32).toString('hex');
    await prisma.oauthConnectionState.create({ data: { tokenHash: hash(token), browserHash: hash(browser), provider: payload.provider, userId: payload.userId, accountId: payload.accountId,
        redirectPath: payload.frontendRedirect, callbackUrl: payload.callbackUrl, reconnectId: payload.reconnectId, expiresAt: new Date(Date.now() + 600000) } });
    cookie(reply, token, browser, 600);
    return token;
}
export async function verifySignedOauthState(state: string, request: FastifyRequest, reply: FastifyReply, provider: Payload['provider']): Promise<Payload | null> {
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return null;
    const matches = (request.headers.cookie || '').split(';').map(part => part.trim().split('=')).filter(([name]) => name === cookieName(state));
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0][1] || '')) return null;
    const tokenHash = hash(state), browserHash = hash(matches[0][1]);
    const grant = await prisma.oauthConnectionState.findUnique({ where: { tokenHash } });
    if (!grant || grant.provider !== provider || grant.browserHash !== browserHash || grant.consumedAt || grant.expiresAt <= new Date()) return null;
    const parsed = payloadSchema.safeParse({ accountId: grant.accountId, userId: grant.userId, provider: grant.provider, frontendRedirect: grant.redirectPath, callbackUrl: grant.callbackUrl, ...(grant.reconnectId ? { reconnectId: grant.reconnectId } : {}) });
    if (!parsed.success) return null;
    const claimed = await prisma.oauthConnectionState.updateMany({ where: { tokenHash, browserHash, provider, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) return null;
    cookie(reply, state, '', 0);
    await assertOauthPermission(grant.userId, grant.accountId, provider);
    return parsed.data;
}
