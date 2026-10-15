import { AI_LIMITS } from '../../config/limits';

export class AIRequestError extends Error {
    constructor(message: string, public readonly statusCode: number = 502) { super(message); }
}

export type AIMessage = {
    role: 'system' | 'user';
    content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
};

/** Small shared transport for structured, optionally multimodal AI features. */
export class OpenRouterClient {
    private static capabilities: { expires: number; models: Map<string, boolean> } | null = null;

    static async supportsImages(model: string): Promise<boolean> {
        if (!this.capabilities || this.capabilities.expires < Date.now()) {
            try {
                const response = await fetch(AI_LIMITS.MODELS_ENDPOINT, { signal: AbortSignal.timeout(10_000) });
                if (!response.ok) return false;
                const data = await response.json() as any;
                if (!Array.isArray(data.data)) return false;
                this.capabilities = {
                    expires: Date.now() + 5 * 60_000,
                    models: new Map(data.data.map((entry: any) => [entry.id, entry.architecture?.input_modalities?.includes('image') === true]))
                };
            } catch { return false; }
        }
        return this.capabilities.models.get(model) === true;
    }

    static async completeJson(apiKey: string, model: string, messages: AIMessage[]): Promise<unknown> {
        let response: Response;
        try {
            response = await fetch(AI_LIMITS.API_ENDPOINT, {
                method: 'POST',
                signal: AbortSignal.timeout(60_000),
                headers: {
                    Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.APP_URL || 'https://localhost:3000',
                    'X-Title': `${process.env.APP_NAME || 'Commerce Platform'} Creative Review`
                },
                body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.3, max_tokens: 2400 })
            });
        } catch {
            throw new AIRequestError('AI provider timed out or could not be reached. Please retry.', 503);
        }
        if (!response.ok) {
            if (response.status === 429) throw new AIRequestError('AI provider rate limit reached. Please try again shortly.', 429);
            throw new AIRequestError('AI provider could not complete the creative review. Check your AI settings and model capabilities.');
        }
        try {
            const data = await response.json() as any;
            const content = data.choices?.[0]?.message?.content;
            if (typeof content !== 'string') throw new Error('Missing content');
            return JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        } catch {
            throw new AIRequestError('AI provider returned an invalid review. Please retry.');
        }
    }
}
