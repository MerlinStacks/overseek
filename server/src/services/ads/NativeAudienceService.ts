import { createHash } from 'crypto';
import { prisma } from '../../utils/prisma';
import { QueueFactory } from '../queue/QueueFactory';
import { buildMetaUrl, fetchAllMetaRows } from './MetaAdsService';
import { createGoogleAdsRestConfig } from './GoogleAdsClient';
import { buildGoogleWebsiteList, buildMetaWebsiteRule, LookalikeDefinition, WebsiteAudienceDefinition } from './nativeAudienceRules';

export class NativeAudienceError extends Error {
    constructor(message: string, public statusCode = 400) { super(message); }
}

export class NativeAudienceService {
    static platformName(audience: { name: string; id: string }) {
        return `${audience.name} [OS-${audience.id}]`;
    }

    static async destination(accountId: string, adAccountId: string) {
        const destination = await prisma.adAccount.findFirst({ where: { id: adAccountId, accountId, platform: { in: ['META', 'GOOGLE'] } } });
        if (!destination) throw new NativeAudienceError('Advertising account not found', 404);
        return destination;
    }

    static async sources(accountId: string, adAccountId: string) {
        const destination = await this.destination(accountId, adAccountId);
        if (destination.platform !== 'META') return { pixels: [], lookalikeSources: [] };
        if (!destination.externalId || !destination.accessToken) throw new NativeAudienceError('Reconnect this Meta advertising account');
        const actId = destination.externalId.startsWith('act_') ? destination.externalId : `act_${destination.externalId}`;
        let pixels: { id: string; name: string }[];
        try {
            const rows = await fetchAllMetaRows(buildMetaUrl(`${actId}/adspixels`, { fields: 'id,name', limit: 100 }), destination.accessToken);
            pixels = rows.filter(row => typeof row.id === 'string' && /^\d+$/.test(row.id)).map(row => ({ id: row.id, name: String(row.name || row.id) }));
        } catch {
            throw new NativeAudienceError('Could not load Meta pixels. Check the connection and pixel/dataset access.', 502);
        }
        const [lists, websites] = await Promise.all([
            prisma.audienceSync.findMany({
                where: { accountId, adAccountId, platform: 'META', isLookalike: false, externalId: { not: null }, lastSyncAt: { not: null } },
                select: { id: true, audienceName: true, autoSyncEnabled: true }
            }),
            prisma.nativeAdAudience.findMany({
                where: { accountId, adAccountId, platform: 'META', kind: 'WEBSITE', status: 'CREATED', externalId: { not: null } },
                select: { id: true, name: true }
            })
        ]);
        return {
            pixels,
            lookalikeSources: [
                ...lists.map(list => ({ id: list.id, type: 'CUSTOMER_LIST', name: list.audienceName, autoSyncEnabled: list.autoSyncEnabled })),
                ...websites.map(website => ({ id: website.id, type: 'WEBSITE', name: website.name }))
            ]
        };
    }

    static async sourceExternalId(accountId: string, adAccountId: string, definition: LookalikeDefinition) {
        const source = definition.sourceType === 'CUSTOMER_LIST'
            ? await prisma.audienceSync.findFirst({ where: {
                id: definition.sourceId, accountId, adAccountId, platform: 'META', isLookalike: false,
                externalId: { not: null }, lastSyncAt: { not: null }
            } })
            : await prisma.nativeAdAudience.findFirst({ where: {
                id: definition.sourceId, accountId, adAccountId, platform: 'META', kind: 'WEBSITE', status: 'CREATED', externalId: { not: null }
            } });
        if (!source?.externalId) throw new NativeAudienceError('Choose a created website audience or successfully uploaded customer list in this Meta account');
        return source.externalId;
    }

    static async enqueue(accountId: string, id: string) {
        await QueueFactory.createQueue('scheduler').add('create-native-ad-audience', { accountId, id }, {
            jobId: `native-ad-audience-${id}`, removeOnComplete: true, removeOnFail: true,
            attempts: 3, backoff: { type: 'exponential', delay: 60000 }
        });
    }

    static async create(accountId: string, adAccountId: string, kind: 'WEBSITE' | 'LOOKALIKE', name: string, definition: WebsiteAudienceDefinition | LookalikeDefinition) {
        const destination = await this.destination(accountId, adAccountId);
        if (kind === 'LOOKALIKE') {
            if (destination.platform !== 'META') throw new NativeAudienceError('This workflow creates Meta lookalikes only. Google expansion is campaign-specific.');
            await this.sourceExternalId(accountId, adAccountId, definition as LookalikeDefinition);
        } else if (destination.platform === 'META') {
            const { pixels } = await this.sources(accountId, adAccountId);
            if (!pixels.some(pixel => pixel.id === (definition as WebsiteAudienceDefinition).pixelId)) throw new NativeAudienceError('Pixel is not accessible in this Meta account');
        }
        const definitionKey = createHash('sha256').update(JSON.stringify({ kind, definition })).digest('hex');
        // Different names do not create duplicate definitions on repeated clicks.
        const audience = await prisma.nativeAdAudience.upsert({
            where: { accountId_adAccountId_definitionKey: { accountId, adAccountId, definitionKey } },
            create: { accountId, adAccountId, platform: destination.platform, kind, name, definitionKey, definition: definition as any, consentConfirmedAt: new Date() },
            update: {}
        });
        if (audience.status === 'PENDING') await this.enqueue(accountId, audience.id);
        return audience;
    }

    /** Recover queue-dispatch failures; platform-managed membership needs no hourly uploads. */
    static async dispatchPending() {
        const pending = await prisma.nativeAdAudience.findMany({ where: { status: 'PENDING' }, select: { id: true, accountId: true }, take: 100 });
        for (const audience of pending) await this.enqueue(audience.accountId, audience.id);
        // A worker killed after the request may have created the audience. Never blindly create it again.
        await prisma.nativeAdAudience.updateMany({
            where: { status: 'CREATING', updatedAt: { lt: new Date(Date.now() - 15 * 60000) } },
            data: { status: 'NEEDS_REVIEW', lastError: 'Creation was interrupted. Check the platform for this audience before creating another.' }
        });
    }

    static async provision(accountId: string, id: string) {
        const audience = await prisma.nativeAdAudience.findFirst({ where: { id, accountId } });
        if (!audience || audience.externalId || audience.status !== 'PENDING') return;
        const claim = await prisma.nativeAdAudience.updateMany({ where: { id, accountId, status: 'PENDING' }, data: { status: 'CREATING', lastError: null } });
        if (!claim.count) return;
        let requestStarted = false;
        let rejected = false;
        try {
            const destination = await this.destination(accountId, audience.adAccountId);
            if (destination.platform !== audience.platform) throw new NativeAudienceError('Destination platform has changed');
            const definition = audience.definition as unknown as WebsiteAudienceDefinition & LookalikeDefinition;
            const name = this.platformName(audience);
            let response: Response;
            if (destination.platform === 'META') {
                if (!destination.externalId || !destination.accessToken) throw new NativeAudienceError('Reconnect this Meta account');
                let payload: Record<string, unknown>;
                if (audience.kind === 'LOOKALIKE') {
                    const sourceId = await this.sourceExternalId(accountId, audience.adAccountId, definition);
                    payload = {
                        name, subtype: 'LOOKALIKE', origin_audience_id: sourceId,
                        lookalike_spec: { type: 'similarity', country: definition.country, ratio: definition.percent / 100 }
                    };
                } else {
                    const { pixels } = await this.sources(accountId, audience.adAccountId);
                    if (!pixels.some(pixel => pixel.id === definition.pixelId)) throw new NativeAudienceError('Pixel access is no longer available');
                    payload = {
                        name, subtype: 'WEBSITE', pixel_id: definition.pixelId,
                        retention_days: Math.max(definition.retentionDays, definition.excludePurchasers ? definition.exclusionDays : 1),
                        prefill: true, rule: buildMetaWebsiteRule(definition)
                    };
                }
                const actId = destination.externalId.startsWith('act_') ? destination.externalId : `act_${destination.externalId}`;
                requestStarted = true;
                response = await fetch(buildMetaUrl(`${actId}/customaudiences`), {
                    method: 'POST', headers: { Authorization: `Bearer ${destination.accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
                });
            } else {
                if (audience.kind !== 'WEBSITE') throw new NativeAudienceError('Unsupported Google audience type');
                const google = await createGoogleAdsRestConfig(audience.adAccountId);
                requestStarted = true;
                response = await fetch(`https://googleads.googleapis.com/v24/customers/${google.customerId}/userLists:mutate`, {
                    method: 'POST', headers: {
                        Authorization: `Bearer ${google.accessToken}`, 'Content-Type': 'application/json', 'developer-token': google.developerToken,
                        ...(google.loginCustomerId ? { 'login-customer-id': google.loginCustomerId } : {})
                    },
                    body: JSON.stringify({ operations: [{ create: buildGoogleWebsiteList(name, definition) }] }),
                    signal: AbortSignal.timeout(30000)
                });
            }
            // Only an explicit client-error rejection is safe to recreate automatically/manual retry.
            rejected = response.status >= 400 && response.status < 500;
            const result = await response.json() as any;
            if (!response.ok || result.error || result.partialFailureError) throw new Error('Platform rejected creation');
            const externalId = destination.platform === 'META' ? result.id : result.results?.[0]?.resourceName;
            if (typeof externalId !== 'string' || !externalId) throw new Error('No platform audience ID returned');
            await prisma.nativeAdAudience.update({ where: { id }, data: { externalId, status: 'CREATED', lastError: null } });
        } catch {
            const uncertain = requestStarted && !rejected;
            await prisma.nativeAdAudience.updateMany({ where: { id, accountId, status: 'CREATING' }, data: {
                status: uncertain ? 'NEEDS_REVIEW' : 'FAILED',
                lastError: uncertain
                    ? 'Creation outcome is uncertain. Check the platform for this audience before creating another; no automatic duplicate will be created.'
                    : 'Creation failed. Check account/pixel access, customer-data terms, active remarketing tags, or lookalike source eligibility and size, then retry.'
            } });
        }
    }

    /** Recover a successful remote creation whose response/local acknowledgement was lost. */
    static async reconcile(accountId: string, id: string) {
        const audience = await prisma.nativeAdAudience.findFirst({ where: { id, accountId } });
        if (!audience) throw new NativeAudienceError('Audience not found', 404);
        if (audience.status !== 'NEEDS_REVIEW') throw new NativeAudienceError('Only uncertain creations need reconciliation', 409);
        const destination = await this.destination(accountId, audience.adAccountId);
        const name = this.platformName(audience);
        let matches: string[];
        try {
            if (destination.platform === 'META') {
                if (!destination.externalId || !destination.accessToken) throw new Error('Invalid Meta account');
                const actId = destination.externalId.startsWith('act_') ? destination.externalId : `act_${destination.externalId}`;
                const rows = await fetchAllMetaRows(buildMetaUrl(`${actId}/customaudiences`, { fields: 'id,name,subtype', limit: 100 }), destination.accessToken);
                matches = rows.filter(row => row.name === name && row.subtype === audience.kind && typeof row.id === 'string').map(row => row.id);
            } else {
                const google = await createGoogleAdsRestConfig(audience.adAccountId);
                const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const response = await fetch(`https://googleads.googleapis.com/v24/customers/${google.customerId}/googleAds:search`, {
                    method: 'POST', headers: {
                        Authorization: `Bearer ${google.accessToken}`, 'Content-Type': 'application/json', 'developer-token': google.developerToken,
                        ...(google.loginCustomerId ? { 'login-customer-id': google.loginCustomerId } : {})
                    },
                    body: JSON.stringify({ query: `SELECT user_list.resource_name, user_list.name, user_list.type FROM user_list WHERE user_list.name = '${escapedName}'` }),
                    signal: AbortSignal.timeout(30000)
                });
                const body = await response.json() as any;
                if (!response.ok || body.error) throw new Error('Google lookup failed');
                matches = (body.results || []).filter((row: any) => row.userList?.name === name && row.userList?.type === 'RULE_BASED')
                    .map((row: any) => row.userList.resourceName).filter((value: unknown) => typeof value === 'string');
            }
        } catch {
            throw new NativeAudienceError('Could not check the platform. Verify account access and try again.', 502);
        }
        if (matches.length !== 1) throw new NativeAudienceError('No unique matching audience found yet. Check the platform manually; this action will not create a duplicate.', 409);
        await prisma.nativeAdAudience.updateMany({ where: { id, accountId, status: 'NEEDS_REVIEW' }, data: { externalId: matches[0], status: 'CREATED', lastError: null } });
        return { id, status: 'CREATED' };
    }
}
