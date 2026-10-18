export interface EmailUtmConfig {
    appendUtm?: boolean;
    campaignSource?: string;
    campaignMedium?: string;
    campaignName?: string;
    campaignTerm?: string;
    campaignContent?: string;
}

/** Tag public navigation links before click tracking. Never tag preference/opt-out links. */
export function appendEmailUtm(html: string, config: EmailUtmConfig, defaultCampaign: string): string {
    if (config.appendUtm === false) return html;
    const parameters: Record<string, string> = {
        utm_source: config.campaignSource?.trim() || 'overseek',
        utm_medium: config.campaignMedium?.trim() || 'Email',
        utm_campaign: config.campaignName?.trim() || defaultCampaign,
        utm_term: config.campaignTerm?.trim() || '',
        utm_content: config.campaignContent?.trim() || '',
    };
    return html.replace(/(<a\b[^>]*?\s+href\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, prefix, doubleQuoted: string | undefined, singleQuoted: string | undefined, unquoted: string | undefined) => {
        const quote = singleQuoted !== undefined ? "'" : '"';
        const href = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
        const decoded = href.replace(/&amp;|&#0*38;|&#x0*26;/gi, '&');
        if (!/^https?:\/\//i.test(decoded) || /\{\{|unsubscribe|preferences|opt[-_]?out/i.test(decoded)) return match;
        try {
            const url = new URL(decoded);
            for (const [key, value] of Object.entries(parameters)) {
                if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
            }
            const escaped = url.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            return `${prefix}${quote}${escaped}${quote}`;
        } catch {
            return match;
        }
    });
}
