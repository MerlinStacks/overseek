/** Provider errors may echo credentials or identifiers; retain useful text, never raw responses. */
export function sanitizeAudienceErrorText(value: unknown, secrets: string[] = []): string {
    if (typeof value !== 'string') return '';
    let text = value;
    // Redact exact configured credentials before truncation, even when echoed without a field name.
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[redacted]');
    return text
        .replace(/\bBearer\s+[^\s,;"'<>]+/gi, 'Bearer [redacted]')
        .replace(/((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|developer[_-]?token|api[_-]?key)["']?\s*[=:]\s*["']?)[^\s&;,"'<>]+/gi, '$1[redacted]')
        .replace(/\bEA[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
        .replace(/\b[a-f0-9]{64}\b/gi, '[hash redacted]')
        .replace(/<[^>]*>/g, '')
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, 1200);
}

export function describeAudienceRejection(platform: string, status: number, body: any, secrets: string[] = [], operation: 'creation' | 'sync' = 'creation'): string {
    const error = body?.error;
    const code = Number.isInteger(error?.code) ? `; code ${error.code}` : '';
    const subcode = Number.isInteger(error?.error_subcode) ? `; subcode ${error.error_subcode}` : '';
    const trace = typeof error?.fbtrace_id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(error.fbtrace_id)
        ? ` Reference: ${error.fbtrace_id}.` : '';
    const candidates: unknown[] = [error?.error_user_title, error?.error_user_msg || error?.message];
    if (Array.isArray(error?.details)) {
        for (const detail of error.details.slice(0, 3)) {
            if (Array.isArray(detail?.errors)) {
                for (const item of detail.errors.slice(0, 3)) {
                    candidates.push(item?.message);
                    // Symbolic Google errors distinguish access/eligibility from malformed data.
                    // Ignore trigger values and other request data that can contain identifiers.
                    if (item?.errorCode && typeof item.errorCode === 'object') {
                        for (const [key, value] of Object.entries(item.errorCode)) {
                            if (/^[a-zA-Z]+$/.test(key) && typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(value)) candidates.push(`${key}: ${value}`);
                        }
                    }
                }
            }
        }
    }
    const messages = [...new Set(candidates.map(value => sanitizeAudienceErrorText(value, secrets)).filter(Boolean))];
    return `${platform === 'META' ? 'Meta' : 'Google'} rejected audience ${operation} (HTTP ${status}${code}${subcode}). ${messages.join(' · ') || 'No readable error detail was returned. Check account access and audience rules.'}${trace}`.slice(0, 2000);
}
