/**
 * Ad Intelligence API Routes
 *
 * Endpoints that serve the SC↔Ads bridge data to the frontend.
 * Kept as a Fastify sub-plugin registered under /api/ads/intelligence.
 */

import { FastifyPluginAsync } from 'fastify';
import { Logger } from '../../utils/logger';
import { SearchToAdsIntelligenceService } from '../../services/ads/SearchToAdsIntelligenceService';
import { NegativeKeywordAnalyzer } from '../../services/tools/analyzers/NegativeKeywordAnalyzer';
import { CannibalizationAnalyzer } from '../../services/tools/analyzers/CannibalizationAnalyzer';

const intelligenceRoutes: FastifyPluginAsync = async (fastify) => {

    /**
     * GET /api/ads/intelligence/correlation
     * Returns organic ↔ paid keyword correlation data.
     */
    fastify.get('/correlation', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const correlation = await SearchToAdsIntelligenceService.getCorrelation(accountId);
            return correlation;
        } catch (error: any) {
            Logger.error('Failed to fetch intelligence correlation', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/ads/intelligence/cannibalization
     * Returns cannibalization analysis results.
     */
    fastify.get('/cannibalization', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const result = await CannibalizationAnalyzer.analyze(accountId);
            return result;
        } catch (error: any) {
            Logger.error('Failed to fetch cannibalization analysis', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/ads/intelligence/negative-keywords
     * Returns negative keyword suggestions.
     */
    fastify.get('/negative-keywords', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const result = await NegativeKeywordAnalyzer.analyze(accountId);
            return result;
        } catch (error: any) {
            Logger.error('Failed to fetch negative keyword suggestions', { error });
            return reply.code(500).send({ error: error.message });
        }
    });

    /**
     * GET /api/ads/intelligence/summary
     * Lightweight endpoint: returns only summary metrics for the dashboard header.
     *
     * Why we don't call CannibalizationAnalyzer here: it internally calls
     * getCorrelation again, doubling the Google Ads + SC API calls. Instead
     * we derive cannibalization counts from the correlation result we already have.
     */
    fastify.get('/summary', async (request, reply) => {
        try {
            const accountId = request.accountId;
            if (!accountId) return reply.code(400).send({ error: 'No account selected' });

            const [correlation, negativeKw] = await Promise.all([
                SearchToAdsIntelligenceService.getCorrelation(accountId),
                NegativeKeywordAnalyzer.analyze(accountId)
            ]);

            // Derive cannibalization count directly from the overlap data
            const cannibalizationCount = correlation.overlap
                .filter(o => o.cannibalizationScore >= 50)
                .length;

            return {
                overlapCount: correlation.summary.overlapCount,
                organicOnlyCount: correlation.summary.organicOnlyCount,
                estimatedWastedSpend: correlation.summary.estimatedTotalWastedSpend,
                estimatedUntappedValue: correlation.summary.estimatedUntappedValue,
                cannibalizationCount,
                negativeCandidates: negativeKw.summary.negativeCandidates,
                estimatedMonthlySavings: negativeKw.summary.estimatedMonthlySavings,
                hasData: correlation.overlap.length > 0 || negativeKw.hasData
            };
        } catch (error: any) {
            Logger.error('Failed to fetch intelligence summary', { error });
            return reply.code(500).send({ error: error.message });
        }
    });
};

export default intelligenceRoutes;
