export type OutboundSafetySeverity = 'warning' | 'block';

export interface OutboundSafetyIssue {
    code: string;
    severity: OutboundSafetySeverity;
    message: string;
}

const FORBIDDEN_PHRASES = [
    'guaranteed refund',
    'chargeback us',
    'free money',
    'lawsuit'
];

const TOXIC_WORDS = ['idiot', 'stupid', 'shut up', 'dumb'];

function uppercaseRatio(input: string): number {
    const letters = input.replace(/[^a-zA-Z]/g, '');
    if (!letters.length) return 0;
    const upper = letters.replace(/[^A-Z]/g, '').length;
    return upper / letters.length;
}

/**
 * Lightweight outbound linting for inbox messages.
 * Goal: catch obvious high-risk mistakes before external delivery.
 */
export function lintOutboundMessage(content: string): OutboundSafetyIssue[] {
    const issues: OutboundSafetyIssue[] = [];
    const normalized = content.toLowerCase();

    // Basic sensitive data patterns
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) {
        issues.push({
            code: 'pii_ssn',
            severity: 'block',
            message: 'Potential SSN detected. Remove sensitive personal data before sending.'
        });
    }
    if (/\b(?:\d[ -]*?){13,16}\b/.test(content)) {
        issues.push({
            code: 'pii_card',
            severity: 'block',
            message: 'Potential card number detected. Remove payment card details before sending.'
        });
    }

    for (const phrase of FORBIDDEN_PHRASES) {
        if (normalized.includes(phrase)) {
            issues.push({
                code: `forbidden_${phrase.replace(/\s+/g, '_')}`,
                severity: 'block',
                message: `Phrase "${phrase}" is blocked by outbound safety rules.`
            });
        }
    }

    for (const word of TOXIC_WORDS) {
        if (normalized.includes(word)) {
            issues.push({
                code: `tone_${word.replace(/\s+/g, '_')}`,
                severity: 'warning',
                message: `Tone check: "${word}" may be perceived as hostile.`
            });
        }
    }

    if (uppercaseRatio(content) > 0.6 && content.length > 24) {
        issues.push({
            code: 'tone_all_caps',
            severity: 'warning',
            message: 'Message appears mostly ALL CAPS. Consider softening tone.'
        });
    }

    return issues;
}
