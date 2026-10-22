export function assertBroadcastReady(campaign: { subject: string; content: string; subjectB?: string | null }) {
    let error = '';
    if (!campaign.subject?.trim() || !campaign.content?.trim()) error = 'Campaign must have subject and content before sending';
    else if (!/<a\b[^>]*\bhref\s*=\s*["'][^"']*(?:unsubscribe|preferences_url)[^"']*["']/i.test(campaign.content)) error = 'Marketing broadcasts require a working unsubscribe or preferences link';
    else if ([campaign.subject, campaign.subjectB || '', campaign.content].some(value => /\{\{\s*\}\}/.test(value))) error = 'Remove empty merge-tag placeholders before sending';
    if (error) throw Object.assign(new Error(error), { statusCode: 400 });
}
