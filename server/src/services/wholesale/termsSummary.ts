import z from 'zod';
import { prisma } from '../../utils/prisma';
import { WholesaleValidationError } from './products';

const resultSchema = z.object({ heading: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(5000) }).strict();
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15000;

export function parseTermsSummaryResponse(raw: string, originalLength: number, targetReduction: number) {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new WholesaleValidationError('AI returned invalid JSON'); }
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success) throw new WholesaleValidationError('AI returned an invalid terms suggestion');
    if (parsed.data.content.length >= originalLength) throw new WholesaleValidationError('AI suggestion was not shorter than the original');
    const maximum = Math.floor(originalLength * (1 - targetReduction / 100));
    if (parsed.data.content.length > maximum) throw new WholesaleValidationError('AI suggestion did not meet the target reduction');
    return parsed.data;
}

async function boundedText(response: Response) {
    if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new WholesaleValidationError('AI response exceeded the size limit');
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new WholesaleValidationError('AI response exceeded the size limit'); }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

export class WholesaleTermsSummaryService {
    static async suggest(accountId: string, input: { heading: string; content: string; targetReduction: number }) {
        const account = await (prisma as any).account.findUnique({ where: { id: accountId }, select: { openRouterApiKey: true, aiModel: true } });
        if (!account?.openRouterApiKey || !account.aiModel) {
            return { manualGuidance: 'Configure an account OpenRouter API key and AI model, or shorten this section manually while preserving all numbers, dates, thresholds and obligations.' };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST', signal: controller.signal,
                headers: { Authorization: `Bearer ${account.openRouterApiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: account.aiModel, temperature: 0.1, max_tokens: 1800,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: 'Shorten wholesale commercial terms without changing legal or commercial meaning. Preserve every number, threshold, date, price, timeframe, exception, right and obligation. Return only strict JSON with exactly two string keys: heading and content. Do not add commentary.' },
                        { role: 'user', content: JSON.stringify({ heading: input.heading, content: input.content, targetReductionPercent: input.targetReduction }) },
                    ],
                }),
            });
            const raw = await boundedText(response);
            if (!response.ok) throw new WholesaleValidationError(`AI suggestion request failed (${response.status})`);
            let envelope: any;
            try { envelope = JSON.parse(raw); } catch { throw new WholesaleValidationError('AI service returned invalid JSON'); }
            const content = envelope?.choices?.[0]?.message?.content;
            if (typeof content !== 'string') throw new WholesaleValidationError('AI service returned no suggestion');
            return { suggestion: parseTermsSummaryResponse(content, input.content.length, input.targetReduction) };
        } catch (error: any) {
            if (error?.name === 'AbortError') throw new WholesaleValidationError('AI suggestion request timed out');
            throw error;
        } finally { clearTimeout(timer); }
    }
}
