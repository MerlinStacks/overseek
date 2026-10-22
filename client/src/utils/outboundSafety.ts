type OutboundSafetySeverity = 'warning' | 'block';

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
    // Advisory browser lint, not an authoritative PII/security enforcement boundary.
    const text = typeof content === 'string' ? content.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '') : '';
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const phrasePresent = (phrase: string) => new RegExp(`(^|[^\\p{L}\\p{N}_])${phrase.replace(/ /g, '\\s+')}($|[^\\p{L}\\p{N}_])`, 'u').test(normalized);

    // Basic sensitive data patterns
    if (/(^|[^\d])\d{3}-\d{2}-\d{4}(?!\d)/.test(text)) {
        issues.push({
            code: 'pii_ssn',
            severity: 'block',
            message: 'Potential SSN detected. Remove sensitive personal data before sending.'
        });
    }
    // Consume the whole digit/separator run, never a 13–19 digit fragment of a longer number.
    // Deliberately flag plausible candidates even when Luhn fails: mistyped card details are sensitive too.
    const candidates = text.match(/\d(?:[\d \t\r\n-]*\d)?/g) ?? [];
    if (candidates.some(candidate => { const count = candidate.replace(/\D/g, '').length; return count >= 13 && count <= 19; })) {
        issues.push({
            code: 'pii_card',
            severity: 'block',
            message: 'Potential card number detected. Remove payment card details before sending.'
        });
    }

    for (const phrase of FORBIDDEN_PHRASES) {
        if (phrasePresent(phrase)) {
            issues.push({
                code: `forbidden_${phrase.replace(/\s+/g, '_')}`,
                severity: 'block',
                message: `Phrase "${phrase}" is blocked by outbound safety rules.`
            });
        }
    }

    for (const word of TOXIC_WORDS) {
        if (phrasePresent(word)) {
            issues.push({
                code: `tone_${word.replace(/\s+/g, '_')}`,
                severity: 'warning',
                message: `Tone check: "${word}" may be perceived as hostile.`
            });
        }
    }

    if (uppercaseRatio(text) > 0.6 && text.length > 24) {
        issues.push({
            code: 'tone_all_caps',
            severity: 'warning',
            message: 'Message appears mostly ALL CAPS. Consider softening tone.'
        });
    }

    return issues;
}
