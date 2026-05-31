export type EmailCategory = 'MARKETING' | 'TRANSACTIONAL';

export interface PreflightIssue {
    id: string;
    severity: 'warning' | 'blocking';
    message: string;
}

export interface GroupedPreflightIssues {
    blocking: PreflightIssue[];
    warning: PreflightIssue[];
}

interface PreflightInput {
    html: string;
    subject?: string;
    emailCategory?: EmailCategory;
    to?: string;
    overrideFrom?: boolean;
    fromEmail?: string;
    replyToEmail?: string;
}

const SIMPLE_EMAIL_RE = /^\S+@\S+\.\S+$/;

function isMergeTag(value: string) {
    return /\{\{[^}]+\}\}/.test(value);
}

export function evaluateEmailPreflight({ html, subject = '', emailCategory = 'MARKETING', to = '{{customer.email}}', overrideFrom, fromEmail = '', replyToEmail = '' }: PreflightInput): PreflightIssue[] {
    const issues: PreflightIssue[] = [];
    const trimmedHtml = html.trim();
    const trimmedSubject = subject.trim();
    const lower = trimmedHtml.toLowerCase();

    if (!trimmedSubject) {
        issues.push({ id: 'subject', severity: 'blocking', message: 'Subject is required before preview/testing.' });
    }

    const recipients = to.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (recipients.length === 0) {
        issues.push({ id: 'recipient', severity: 'blocking', message: 'At least one recipient is required.' });
    }

    const invalidRecipients = recipients.filter((recipient) => !isMergeTag(recipient) && !SIMPLE_EMAIL_RE.test(recipient));
    if (invalidRecipients.length > 0) {
        issues.push({ id: 'recipient-format', severity: 'blocking', message: 'One or more recipients are not valid email addresses or merge tags.' });
    }

    if (overrideFrom) {
        if (fromEmail.trim() && !SIMPLE_EMAIL_RE.test(fromEmail.trim())) {
            issues.push({ id: 'from-email', severity: 'blocking', message: 'Override From Email is not a valid email address.' });
        }
        if (replyToEmail.trim() && !SIMPLE_EMAIL_RE.test(replyToEmail.trim())) {
            issues.push({ id: 'reply-to-email', severity: 'blocking', message: 'Reply To Email is not a valid email address.' });
        }
    }

    if (!trimmedHtml) {
        issues.push({ id: 'content', severity: 'blocking', message: 'Email content is empty.' });
        return issues;
    }

    const hasLink = /<a\s+[^>]*href=["'][^"']+["'][^>]*>/i.test(trimmedHtml);
    if (!hasLink) {
        issues.push({ id: 'cta', severity: 'warning', message: 'No CTA link detected. Consider adding at least one action link.' });
    }

    const hasUnsubscribe = lower.includes('unsubscribe');
    if (emailCategory === 'MARKETING' && !hasUnsubscribe) {
        issues.push({ id: 'unsubscribe', severity: 'blocking', message: 'Marketing emails should include unsubscribe wording.' });
    }

    const hasGenericMergeTag = /{{\s*}}/.test(trimmedHtml) || /{{\s*}}/.test(trimmedSubject);
    if (hasGenericMergeTag) {
        issues.push({ id: 'merge-tag', severity: 'blocking', message: 'Found unresolved merge tag placeholder {{}}.' });
    }

    const imageTags = trimmedHtml.match(/<img\s+[^>]*>/gi) || [];
    const hasMissingAlt = imageTags.some((img) => !/alt\s*=\s*['"][^'"]+['"]/i.test(img));
    if (hasMissingAlt) {
        issues.push({ id: 'alt', severity: 'warning', message: 'Some images are missing alt text.' });
    }

    const hasNonAbsoluteImageUrl = imageTags.some((img) => {
        const srcMatch = img.match(/src\s*=\s*['"]([^'"]+)['"]/i);
        if (!srcMatch) return false;
        const src = srcMatch[1].trim();
        if (!src) return true;
        return !/^(https?:|data:|cid:)/i.test(src);
    });
    if (hasNonAbsoluteImageUrl) {
        issues.push({
            id: 'image-absolute-url',
            severity: 'warning',
            message: 'Some images use non-absolute URLs. Use public HTTPS image URLs for reliable inbox rendering.'
        });
    }

    const suspiciousWords = ['free!!!', 'guaranteed', 'act now', 'buy now', 'risk free'];
    const hasSpamWord = suspiciousWords.some((word) => lower.includes(word));
    if (hasSpamWord) {
        issues.push({ id: 'spam-language', severity: 'warning', message: 'Aggressive promo language detected; review deliverability risk.' });
    }

    return issues;
}

export function groupPreflightIssues(issues: PreflightIssue[]): GroupedPreflightIssues {
    return {
        blocking: issues.filter((issue) => issue.severity === 'blocking'),
        warning: issues.filter((issue) => issue.severity === 'warning'),
    };
}
