import { prisma } from '../../utils/prisma';
import { buildMetaUrl, fetchAllMetaRows } from './MetaAdsService';
import { formatDateISO } from './types';

export interface CreativeMetrics {
    spend: number; impressions: number; clicks: number; purchases: number; revenue: number;
    ctr: number; cpc: number | null; cpa: number | null; roas: number;
}

export interface CreativeDetails {
    id: string;
    name: string;
    format: 'image' | 'video' | 'carousel' | 'dynamic' | 'unknown';
    primaryTexts: string[];
    headlines: string[];
    descriptions: string[];
    callToActions: string[];
    assets: { kind: 'image' | 'video_thumbnail'; url: string }[];
    destinationUrl: string | null;
}

export interface CreativePerformance {
    creative: CreativeDetails;
    metrics: CreativeMetrics;
    ads: { id: string; name: string; status: string; frequency: number | null }[];
    fatigue: {
        status: 'potential_fatigue' | 'no_signal' | 'insufficient_data';
        reasons: string[];
        recent: CreativeMetrics;
        previous: CreativeMetrics;
    };
}

export interface CreativeReport {
    adAccountId: string;
    adsetId: string;
    days: number;
    currency: string;
    since: string;
    until: string;
    comparison: { recentSince: string; recentUntil: string; previousSince: string; previousUntil: string } | null;
    creatives: CreativePerformance[];
    warnings: string[];
}

/** Only Meta-hosted images are eligible for preview and optional vision review. */
export function safeMetaImageUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
        if (url.searchParams.has('access_token') || url.searchParams.has('appsecret_proof')) return null;
        return ['fbcdn.net', 'fbsbx.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.toString() : null;
    } catch { return null; }
}

function destination(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
    } catch { return null; }
}

const strings = (values: unknown[]) => [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.slice(0, 5000)))].slice(0, 20);
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; };
const purchase = (values: any[] = []) => number(values.find(value => value.action_type === 'purchase')?.value ?? values.find(value => value.action_type === 'omni_purchase')?.value);

export function parseCreative(raw: any, fallbackId: string): CreativeDetails {
    const story = raw?.object_story_spec || {};
    const link = story.link_data || {};
    const video = story.video_data || {};
    const feed = raw?.asset_feed_spec || {};
    const children: any[] = Array.isArray(link.child_attachments) ? link.child_attachments : [];
    const images: any[] = Array.isArray(feed.images) ? feed.images : [];
    const videos: any[] = Array.isArray(feed.videos) ? feed.videos : [];
    const hasVideo = !!video.video_id || videos.length > 0 || raw?.object_type === 'VIDEO';
    const dynamic = Object.keys(feed).length > 0;
    const assets: CreativeDetails['assets'] = [];
    const addImage = (value: unknown, kind: 'image' | 'video_thumbnail') => {
        const url = safeMetaImageUrl(value);
        if (url && !assets.some(asset => asset.url === url)) assets.push({ kind, url });
    };
    addImage(raw?.image_url, hasVideo ? 'video_thumbnail' : 'image');
    addImage(link.picture, 'image');
    addImage(video.image_url, 'video_thumbnail');
    children.forEach(child => addImage(child.picture, child.video_id ? 'video_thumbnail' : 'image'));
    images.forEach(image => addImage(image.url, 'image'));
    videos.forEach(item => addImage(item.thumbnail_url, 'video_thumbnail'));
    if (!assets.length) addImage(raw?.thumbnail_url, hasVideo ? 'video_thumbnail' : 'image');
    return {
        id: raw?.id || `unavailable-${fallbackId}`,
        name: raw?.name || 'Creative',
        format: dynamic ? 'dynamic' : children.length > 0 ? 'carousel' : hasVideo ? 'video' : assets.length > 0 ? 'image' : 'unknown',
        primaryTexts: strings([raw?.body, link.message, video.message, ...(feed.bodies || []).map((item: any) => item.text)]),
        headlines: strings([raw?.title, link.name, video.title, ...children.map(child => child.name), ...(feed.titles || []).map((item: any) => item.text)]),
        descriptions: strings([link.description, ...children.map(child => child.description), ...(feed.descriptions || []).map((item: any) => item.text)]),
        callToActions: strings([link.call_to_action?.type, video.call_to_action?.type, ...children.map(child => child.call_to_action?.type), ...(feed.call_to_action_types || [])]),
        assets: assets.slice(0, 20),
        destinationUrl: destination(link.link || video.call_to_action?.value?.link || feed.link_urls?.[0]?.website_url)
    };
}

function metrics(rows: any[]): CreativeMetrics {
    const totals = rows.reduce((result, row) => ({
        spend: result.spend + number(row.spend), impressions: result.impressions + number(row.impressions),
        clicks: result.clicks + number(row.clicks), purchases: result.purchases + purchase(row.actions),
        revenue: result.revenue + purchase(row.action_values)
    }), { spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 });
    return {
        ...totals, ctr: totals.impressions > 0 ? totals.clicks / totals.impressions * 100 : 0,
        cpc: totals.clicks > 0 ? totals.spend / totals.clicks : null,
        cpa: totals.purchases > 0 ? totals.spend / totals.purchases : null,
        roas: totals.spend > 0 ? totals.revenue / totals.spend : 0
    };
}

/** Heuristic, not a causal diagnosis: frequency plus deterioration with adequate samples. */
export function assessCreativeFatigue(recentRows: any[], previousRows: any[], comparable: boolean): CreativePerformance['fatigue'] {
    const recent = metrics(recentRows);
    const previous = metrics(previousRows);
    const enough = comparable && recent.impressions >= 1000 && previous.impressions >= 1000 && recent.clicks >= 20 && previous.clicks >= 20;
    if (!enough) return { status: 'insufficient_data', reasons: ['Needs two complete 7-day windows, each with at least 1,000 impressions and 20 clicks.'], recent, previous };
    const exposed = recentRows.some(row => number(row.frequency) >= 3 && number(row.impressions) >= 1000);
    const ctrDrop = previous.ctr > 0 && recent.ctr <= previous.ctr * 0.8;
    const cpaRise = recent.purchases >= 10 && previous.purchases >= 10 && previous.cpa !== null && recent.cpa !== null && recent.cpa >= previous.cpa * 1.25;
    const reasons: string[] = [];
    if (exposed && (ctrDrop || cpaRise)) {
        reasons.push('At least one ad has frequency ≥3 in the latest 7 days.');
        if (ctrDrop) reasons.push(`CTR fell ${Math.round((1 - recent.ctr / previous.ctr) * 100)}% versus the preceding 7 days.`);
        if (cpaRise) reasons.push('Cost per purchase increased at least 25%, with at least 10 purchases in each window.');
        reasons.push('Potential fatigue only; audience, placement, budget, or offer changes may explain this.');
    }
    return { status: reasons.length ? 'potential_fatigue' : 'no_signal', reasons: reasons.length ? reasons : ['No combined frequency-and-performance fatigue signal detected. This does not prove the creative is healthy.'], recent, previous };
}

export class MetaCreativeService {
    static async getReport(adAccountId: string, adsetId: string, days: number): Promise<CreativeReport> {
        const account = await prisma.adAccount.findUnique({ where: { id: adAccountId } });
        if (!account || account.platform !== 'META' || !account.accessToken || !account.externalId) throw new Error('Invalid Meta Ad Account');
        if (!/^\d+$/.test(adsetId) || !Number.isInteger(days) || days < 1 || days > 365) throw new Error('Invalid creative reporting parameters');
        const actId = account.externalId.startsWith('act_') ? account.externalId : `act_${account.externalId}`;
        const date = (offset: number) => { const value = new Date(); value.setUTCDate(value.getUTCDate() - offset); return formatDateISO(value); };
        // Exclude today's partial day from fatigue comparisons.
        const comparison = days >= 15 ? { recentSince: date(7), recentUntil: date(1), previousSince: date(14), previousUntil: date(8) } : null;
        const since = date(days - 1);
        const until = date(0);
        const filtering = JSON.stringify([{ field: 'adset.id', operator: 'IN', value: [adsetId] }]);
        const insightFields = 'ad_id,ad_name,spend,impressions,clicks,actions,action_values,frequency';
        const insights = (start: string, end: string) => fetchAllMetaRows(buildMetaUrl(`${actId}/insights`, {
            fields: insightFields, level: 'ad', filtering, time_range: JSON.stringify({ since: start, until: end }), limit: 100
        }), account.accessToken!);
        const [ads, rows, recentRows, previousRows] = await Promise.all([
            fetchAllMetaRows(buildMetaUrl(`${actId}/ads`, {
                fields: 'id,name,adset_id,effective_status,creative{id,name,title,body,image_url,thumbnail_url,object_type,object_story_spec,asset_feed_spec}',
                filtering, limit: 100
            }), account.accessToken),
            insights(since, until),
            comparison ? insights(comparison.recentSince, comparison.recentUntil) : Promise.resolve([]),
            comparison ? insights(comparison.previousSince, comparison.previousUntil) : Promise.resolve([])
        ]);
        const metadata = new Map(ads.filter(ad => ad.adset_id === adsetId).map(ad => [ad.id, ad]));
        const groups = new Map<string, { creative: CreativeDetails; rows: any[] }>();
        for (const row of rows) {
            const ad = metadata.get(row.ad_id);
            const creative = parseCreative(ad?.creative, row.ad_id);
            const group = groups.get(creative.id) || { creative, rows: [] };
            group.rows.push(row);
            groups.set(creative.id, group);
        }
        const creatives: CreativePerformance[] = [...groups.values()].map(group => {
            const ids = new Set(group.rows.map(row => row.ad_id));
            return {
                creative: group.creative,
                metrics: metrics(group.rows),
                ads: group.rows.map(row => ({
                    id: row.ad_id, name: metadata.get(row.ad_id)?.name || row.ad_name || 'Ad',
                    status: metadata.get(row.ad_id)?.effective_status || 'UNKNOWN',
                    frequency: row.frequency === undefined ? null : number(row.frequency)
                })),
                fatigue: assessCreativeFatigue(recentRows.filter(row => ids.has(row.ad_id)), previousRows.filter(row => ids.has(row.ad_id)), !!comparison)
            };
        }).sort((a, b) => b.metrics.spend - a.metrics.spend);
        return {
            adAccountId, adsetId, days, currency: account.currency || 'USD', since, until, comparison, creatives,
            warnings: [
                'Creative totals combine the selected ad set’s ads using the same current creative ID. They are not controlled A/B tests.',
                'Results are ad-level attribution, not performance of individual images, text variants, or Advantage+ combinations.',
                'Historical ad metrics may include earlier creative edits. Frequency is per ad and is not summed across ads.',
                'Video previews and visual AI reviews use available thumbnails only, not full video playback or audio.',
                'Meta may omit media or copy for existing-post, catalog, or dynamically generated creatives.'
            ]
        };
    }
}
