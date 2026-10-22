import type { GeneratedCopy } from './adCopyTypes';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 30 && value.every(item => typeof item === 'string' && item.length <= 5000);
export function validateGeneratedCopy(value: unknown): GeneratedCopy {
    const data = value as GeneratedCopy;
    if (!data || !strings(data.headlines) || !data.headlines.length || !strings(data.descriptions) || data.primaryTexts !== undefined && !strings(data.primaryTexts) || data.notes !== undefined && !strings(data.notes) || !['ai', 'template'].includes(data.source) || data.platform !== undefined && (typeof data.platform !== 'string' || data.platform.length > 100)) throw new Error('Invalid generated copy');
    return data;
}
