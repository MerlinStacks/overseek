import { z } from 'zod';
import { prisma } from '../../utils/prisma';
import { AI_LIMITS } from '../../config/limits';
import { AIMessage, AIRequestError, OpenRouterClient } from '../ai/OpenRouterClient';
import { MetaCreativeService } from './MetaCreativeService';
import { CREATIVE_REVIEW_SYSTEM_PROMPT } from './creativeReviewPrompt';

const text = z.string().trim().min(1).max(1000);
export const CreativeReviewSchema = z.object({
    summary: text,
    strengths: z.array(text).max(5),
    concerns: z.array(text).max(5),
    tests: z.array(z.object({ hypothesis: text, primaryText: text, headline: text, visualBrief: text })).min(1).max(3),
    caveats: z.array(text).max(5)
});

export class CreativeReviewService {
    static async review(accountId: string, adAccountId: string, adsetId: string, creativeId: string, days: number, includeVisuals: boolean) {
        // Re-check tenant ownership here as well as in the HTTP boundary.
        const connected = await prisma.adAccount.findFirst({ where: { id: adAccountId, accountId, platform: 'META' }, select: { id: true } });
        if (!connected) throw new AIRequestError('Ad account not found', 404);
        const settings = await prisma.account.findUnique({
            where: { id: accountId }, select: { openRouterApiKey: true, aiModel: true, name: true }
        });
        if (!settings?.openRouterApiKey) throw new AIRequestError('Configure an OpenRouter API key in Settings > AI to review creatives.', 503);
        const report = await MetaCreativeService.getReport(adAccountId, adsetId, days);
        const selected = report.creatives.find(item => item.creative.id === creativeId);
        if (!selected) throw new AIRequestError('Creative not found in this ad set and reporting period', 404);
        const model = settings.aiModel || AI_LIMITS.DEFAULT_MODEL;
        const visionCapable = includeVisuals && selected.creative.assets.length > 0 && await OpenRouterClient.supportsImages(model);
        const assets = visionCapable ? selected.creative.assets.slice(0, 4) : [];
        const caveats: string[] = [];
        if (!includeVisuals) caveats.push('Text and metrics only. Visual review was not requested.');
        else if (!selected.creative.assets.length) caveats.push('No usable Meta-hosted images were available. Visuals were not assessed.');
        else if (!visionCapable) caveats.push('The configured model could not be verified as image-capable. This review used text and metrics only.');
        if (assets.some(asset => asset.kind === 'video_thumbnail')) caveats.push('Video thumbnail reviewed only; video content and audio were not assessed.');
        if (selected.creative.assets.length > assets.length && assets.length > 0) caveats.push('Only the first four available preview images were supplied to the AI.');
        const copy = (values: string[]) => values.slice(0, 5).map(value => value.slice(0, 1500));
        const context = {
            storeName: settings.name,
            period: { since: report.since, until: report.until, currency: report.currency, comparison: report.comparison },
            selected: {
                metrics: selected.metrics, fatigue: selected.fatigue, ads: selected.ads.slice(0, 20),
                creative: {
                    name: selected.creative.name, format: selected.creative.format,
                    primaryTexts: copy(selected.creative.primaryTexts), headlines: copy(selected.creative.headlines),
                    descriptions: copy(selected.creative.descriptions), callToActions: copy(selected.creative.callToActions),
                    assets: assets.map(asset => ({ kind: asset.kind }))
                }
            },
            peers: report.creatives.filter(item => item.creative.id !== creativeId).slice(0, 10).map(item => ({
                name: item.creative.name, format: item.creative.format, metrics: item.metrics
            })),
            limitations: [...report.warnings, ...caveats],
            suppliedVisuals: assets.map((asset, index) => ({ image: index + 1, kind: asset.kind }))
        };
        const content: Exclude<AIMessage['content'], string> = [{ type: 'text', text: JSON.stringify(context) }];
        assets.forEach(asset => content.push({ type: 'image_url', image_url: { url: asset.url } }));
        const output = await OpenRouterClient.completeJson(settings.openRouterApiKey, model, [
            { role: 'system', content: CREATIVE_REVIEW_SYSTEM_PROMPT }, { role: 'user', content }
        ]);
        const parsed = CreativeReviewSchema.safeParse(output);
        if (!parsed.success) throw new AIRequestError('AI returned an incomplete or invalid creative review. Please retry.');
        return {
            ...parsed.data,
            caveats: [...caveats, ...parsed.data.caveats],
            scope: { adAccountId, adsetId, creativeId, days },
            model, reviewedAt: new Date().toISOString(),
            visualReview: { imagesProvided: assets.length, videoReviewed: false }
        };
    }
}
