import { prisma } from '../../../utils/prisma';
import { amount, currencyCode, record, termText, trustedAccount } from '../analysisObservations';

export class KeywordOpportunityAnalyzer {
    static async analyze(accountId: string, activeKeywords?: string[]) {
        trustedAccount(accountId);
        if (activeKeywords && (!Array.isArray(activeKeywords) || activeKeywords.length > 10000 || activeKeywords.some(keyword => termText(keyword) === null))) throw new Error('Invalid keyword sample');
        const end = new Date(), start = new Date(end.getTime() - 30 * 86400000);
        const events = await prisma.analyticsEvent.findMany({ where: { session: { accountId }, type: { in: ['search', 'purchase'] }, createdAt: { gte: start, lt: end } },
            select: { id: true, type: true, payload: true, sessionId: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10001 });
        const lastSearch = new Map<string, { term: string; at: number }>(), seenPurchases = new Set<string>();
        const terms = new Map<string, { searches: number; sessions: Set<string>; converted: Set<string>; value: number; currencies: Set<string>; invalidValue: boolean }>();
        let ambiguousPurchases = 0;
        for (const event of events.slice(0, 10000)) {
            if (typeof event.sessionId !== 'string' || !(event.createdAt instanceof Date) || !Number.isFinite(event.createdAt.getTime())) continue;
            const raw = record(event.payload);
            if (event.type === 'search') {
                const term = termText(raw.query ?? raw.search_term ?? raw.q); if (!term || term.length < 2) continue;
                const value = terms.get(term) || { searches: 0, sessions: new Set<string>(), converted: new Set<string>(), value: 0, currencies: new Set<string>(), invalidValue: false };
                value.searches++; value.sessions.add(event.sessionId); terms.set(term, value); lastSearch.set(event.sessionId, { term, at: event.createdAt.getTime() });
            } else {
                const id = raw.transaction_id ?? raw.order_id;
                if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim() || String(id).length > 200) { ambiguousPurchases++; continue; }
                if (seenPurchases.has(String(id))) continue; seenPurchases.add(String(id));
                const preceding = lastSearch.get(event.sessionId); if (!preceding || preceding.at >= event.createdAt.getTime()) continue;
                const value = terms.get(preceding.term)!; value.converted.add(event.sessionId);
                const money = amount(raw.value ?? raw.revenue), code = currencyCode(raw.currency);
                if (money === null || !code) value.invalidValue = true;
                else { value.value += money; value.currencies.add(code); }
            }
        }
        const active = activeKeywords ? new Set(activeKeywords.map(termText)) : null;
        const observations = [...terms].sort((a, b) => b[1].searches - a[1].searches || a[0].localeCompare(b[0])).slice(0, 100).map(([term, data]) => ({ term, searches: data.searches, sessions: data.sessions.size,
            associatedPurchasingSessions: data.converted.size, sessionAssociationRate: data.sessions.size ? data.converted.size / data.sessions.size * 100 : null,
            conversionValue: !data.invalidValue && data.currencies.size === 1 && Number.isFinite(data.value) ? data.value : null,
            currency: data.currencies.size === 1 ? [...data.currencies][0] : null, paidKeywordCoverage: active ? active.has(term) ? 'in-provided-sample' : 'not-in-provided-sample' : 'unknown' }));
        return { hasData: observations.length > 0, keywordOpportunities: [], negativeKeywordOpportunities: [], bidAdjustments: [], observations,
            suggestions: observations.slice(0, 5).map(row => `Review site-search candidate “${row.term}”: ${row.searches} returned searches and ${row.associatedPurchasingSessions} later associated purchasing sessions. Paid keyword coverage ${row.paidKeywordCoverage}; not an organic-attribution or incremental-revenue claim.`),
            summary: { totalSearchTermsAnalyzed: terms.size, opportunitiesFound: null, estimatedMissedRevenue: null },
            coverage: { start: start.toISOString(), end: end.toISOString(), limit: 10000, truncated: events.length > 10000, complete: false, ambiguousPurchases,
                attribution: 'last strictly preceding same-session search; stable purchase ID deduplication across returned events; associations only', activeKeywordCoverage: active ? 'caller-provided-sample' : 'unavailable' } };
    }
}
