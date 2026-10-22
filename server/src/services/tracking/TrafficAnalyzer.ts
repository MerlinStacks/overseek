import { isIP } from 'node:net';

/**
 * Traffic source analysis and bot detection utilities.
 *
 * Provides methods to parse referrer URLs and classify traffic sources,
 * detect bot/crawler user agents, and mask IP addresses for privacy.
 */

/**
 * Parse referrer URL to determine traffic source category.
 *
 * @param referrer - The referrer URL string
 * @returns Traffic source category: 'organic' | 'social' | 'email' | 'ai' | 'marketplace' | 'news' | 'messaging' | 'referral' | 'direct'
 */
export function parseTrafficSource(referrer: string): string {
    return classifyReferrer(referrer);
}

function classifyReferrer(referrer: string): string {
    if (referrer === '') return 'direct';
    if (typeof referrer !== 'string' || referrer.length > 4096) return 'unknown';
    try {
        const url = new URL(referrer);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return 'unknown';
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        const matches = (domains: string[]) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
        // Specific services precede their parent search domains. Never inspect query text.
        if (matches(['mail.google.com', 'outlook.com', 'outlook.live.com', 'mail.yahoo.com', 'mail.aol.com', 'protonmail.com', 'mailchimp.com', 'campaign-archive.com', 'list-manage.com', 'sendgrid.net', 'mailgun.org'])) return 'email';
        if (matches(['news.google.com', 'news.yahoo.com', 'flipboard.com', 'feedly.com', 'getpocket.com', 'news.ycombinator.com'])) return 'news';
        if (matches(['gemini.google.com', 'bard.google.com', 'chatgpt.com', 'openai.com', 'claude.ai', 'anthropic.com', 'perplexity.ai', 'you.com', 'phind.com', 'copilot.microsoft.com', 'poe.com', 'character.ai']) || matches(['bing.com']) && /^\/chat(?:\/|$)/.test(url.pathname)) return 'ai';
        if (matches(['web.whatsapp.com', 'telegram.org', 't.me', 'signal.org', 'slack.com', 'teams.microsoft.com'])) return 'messaging';
        if (matches(['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'twitter.com', 'x.com', 't.co', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'reddit.com', 'snapchat.com', 'threads.net', 'tumblr.com', 'quora.com', 'medium.com', 'substack.com', 'discord.com', 'twitch.tv', 'vimeo.com'])) return 'social';
        if (matches(['amazon.com', 'amazon.co.uk', 'amazon.com.au', 'ebay.com', 'ebay.com.au', 'etsy.com', 'alibaba.com', 'aliexpress.com', 'shopify.com', 'walmart.com', 'target.com', 'bestbuy.com'])) return 'marketplace';
        if (matches(['google.com', 'google.com.au', 'google.co.uk', 'google.ca', 'google.de', 'google.fr', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com', 'yandex.com', 'yandex.ru', 'ecosia.org', 'ask.com', 'aol.com', 'startpage.com', 'qwant.com', 'search.brave.com', 'naver.com', 'daum.net', 'sogou.com'])) return 'organic';
        return 'referral';
    } catch { return 'unknown'; }
}


/**
 * Check if user agent indicates a bot/crawler.
 *
 * @param userAgent - The user agent string to check
 * @returns True if the user agent matches known bot patterns
 */
export function isBot(userAgent: string): boolean {
    if (typeof userAgent !== 'string' || !userAgent || userAgent.length > 8192) return false;

    const ua = userAgent.toLowerCase();

    const genericBotSignal = /\b(bot|crawler|spider|crawl|scraper|fetcher|scanner|headless)\b/;
    if (genericBotSignal.test(ua)) return true;

    const botPatterns = [
        // Major search engine bots
        'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
        'yandexbot', 'sogou', 'exabot', 'facebot', 'facebookexternalhit',

        // SEO/Monitoring tools
        'semrush', 'ahrefs', 'moz.com', 'dotbot', 'rogerbot',
        'screaming frog', 'sitebulb', 'deepcrawl',

        // AI/LLM crawlers
        'gptbot', 'chatgpt-user', 'claudebot', 'anthropic-ai',
        'ccbot', 'cohere-ai', 'bytespider', 'petalbot',
        'amazonbot', 'applebot',

        // Generic bot indicators
        'bot/', '/bot', 'bot;', 'spider/', 'crawl/', 'scraper',
        'headless', 'phantom', 'selenium', 'puppeteer', 'playwright',
        'wget', 'curl', 'python-requests', 'python-urllib',
        'java/', 'libwww', 'apache-httpclient', 'httpx/',
        'go-http-client', 'ruby/', 'perl/',

        // Uptime monitors
        'pingdom', 'uptimerobot', 'statuscake', 'site24x7',
        'monitis', 'alertra', 'gtmetrix', 'webpagetest',

        // Preview/Link unfurlers
        'twitterbot', 'linkedinbot', 'slackbot', 'telegrambot',
        'discordbot', 'whatsapp', 'skypeuripreview',

        // Security scanners
        'nmap', 'nikto', 'sqlmap', 'masscan', 'zgrab'
    ];

    return botPatterns.some(pattern => ua.includes(pattern));
}

export interface LiveVisitorFilterContext {
    userAgent?: string | null;
    createdAt?: Date | null;
    lastActiveAt?: Date | null;
    eventCount?: number;
    cartValue?: number;
    email?: string | null;
    wooCustomerId?: number | null;
    referrer?: string | null;
    utmSource?: string | null;
    fpScore?: number | null;
}

/**
 * Returns true when a session should be hidden from live visitor widgets.
 * This combines explicit bot user-agent checks with lightweight behavior heuristics.
 */
export function shouldExcludeFromLiveVisitors(session: LiveVisitorFilterContext): boolean {
    return liveVisitorEvidence(session).exclude;
}

/** Filtering is not verified bot identity. A short anonymous visit alone is not evidence. */
export function liveVisitorEvidence(session: LiveVisitorFilterContext): { exclude: boolean; basis: 'unknown-user-agent' | 'user-agent-heuristic' | 'fingerprint-heuristic' | 'not-filtered'; verifiedBot: false } {
    const userAgent = session.userAgent?.trim();
    if (!userAgent || userAgent.length > 8192) return { exclude: true, basis: 'unknown-user-agent', verifiedBot: false };
    if (isBot(userAgent)) return { exclude: true, basis: 'user-agent-heuristic', verifiedBot: false };

    if (typeof session.fpScore === 'number' && Number.isFinite(session.fpScore) && session.fpScore >= 75 && session.fpScore <= 100) {
        return { exclude: true, basis: 'fingerprint-heuristic', verifiedBot: false };
    }
    return { exclude: false, basis: 'not-filtered', verifiedBot: false };
}

/**
 * Mask IP address for privacy - hide last octet for IPv4, last 80 bits for IPv6.
 *
 * @example
 * maskIpAddress('192.168.1.123') // Returns '192.168.1.xxx'
 * maskIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334') // Returns '2001:0db8:85a3::xxxx'
 *
 * @param ip - The IP address to mask
 * @returns Masked IP address string
 */
export function maskIpAddress(ip: string): string {
    if (ip === '') return '';
    if (typeof ip !== 'string' || ip.length > 45 || ip.includes('%')) return 'unavailable';
    if (isIP(ip) === 4) return `${ip.split('.').slice(0, 3).join('.')}.xxx`;
    if (isIP(ip) !== 6) return 'unavailable';
    // URL's IPv6 parser canonicalizes dotted tails; expand before applying a fixed /48.
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split('::');
    const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
    const words = canonical.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
    // IPv4 mapped addresses get the same /24 policy as their plain IPv4 equivalent.
    if (words.slice(0, 5).every(word => parseInt(word, 16) === 0) && parseInt(words[5], 16) === 65535) {
        const high = parseInt(words[6], 16), low = parseInt(words[7], 16);
        return `${high >> 8}.${high & 255}.${low >> 8}.xxx`;
    }
    return `${words.slice(0, 3).map(word => parseInt(word, 16).toString(16)).join(':')}::xxxx`;
}
