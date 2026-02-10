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
    if (!referrer) return 'direct';

    try {
        const url = new URL(referrer);
        const domain = url.hostname.toLowerCase();

        // Organic Search Engines
        const searchEngines = [
            'google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'yandex.',
            'ecosia.', 'ask.com', 'aol.', 'startpage.', 'qwant.', 'brave.',
            'search.', 'naver.', 'daum.', 'sogou.'
        ];
        if (searchEngines.some(se => domain.includes(se))) {
            return 'organic';
        }

        // AI Providers / AI-Assisted Search
        const aiProviders = [
            'chat.openai.', 'openai.', 'chatgpt.',
            'claude.ai', 'anthropic.',
            'bard.google.', 'gemini.google.',
            'perplexity.ai', 'perplexity.',
            'you.com', 'phind.com',
            'copilot.microsoft.', 'bing.com/chat',
            'poe.com', 'character.ai',
            'huggingface.', 'replicate.',
            'jasper.ai', 'writesonic.', 'copy.ai'
        ];
        if (aiProviders.some(ai => domain.includes(ai) || referrer.includes(ai))) {
            return 'ai';
        }

        // Social Media
        const socialPlatforms = [
            'facebook.', 'fb.com', 'fb.me', 'instagram.',
            'twitter.', 'x.com', 't.co',
            'linkedin.', 'pinterest.', 'tiktok.', 'youtube.', 'youtu.be',
            'reddit.', 'snapchat.', 'threads.', 'mastodon.',
            'tumblr.', 'quora.', 'medium.', 'substack.',
            'discord.', 'twitch.', 'vimeo.'
        ];
        if (socialPlatforms.some(sp => domain.includes(sp))) {
            return 'social';
        }

        // Email Providers
        const emailDomains = [
            'mail.google.', 'outlook.', 'mail.yahoo.',
            'mail.aol.', 'protonmail.', 'zoho.mail',
            'mailchimp.', 'campaign-archive', 'list-manage.',
            'sendgrid.', 'mailgun.', 'constantcontact.'
        ];
        if (emailDomains.some(ed => domain.includes(ed))) {
            return 'email';
        }

        // Shopping / Marketplaces
        const shopping = [
            'amazon.', 'ebay.', 'etsy.', 'alibaba.', 'aliexpress.',
            'shopify.', 'walmart.', 'target.', 'bestbuy.'
        ];
        if (shopping.some(s => domain.includes(s))) {
            return 'marketplace';
        }

        // News / Content
        const news = [
            'news.google.', 'news.yahoo.', 'flipboard.',
            'feedly.', 'pocket.', 'getpocket.',
            'hackernews', 'ycombinator.'
        ];
        if (news.some(n => domain.includes(n))) {
            return 'news';
        }

        // Messaging Apps
        const messaging = [
            'web.whatsapp.', 'telegram.', 'signal.',
            'slack.', 'teams.microsoft.'
        ];
        if (messaging.some(m => domain.includes(m))) {
            return 'messaging';
        }

        // Default to referral
        return 'referral';
    } catch {
        return 'direct';
    }
}

/**
 * Check if user agent indicates a bot/crawler.
 *
 * @param userAgent - The user agent string to check
 * @returns True if the user agent matches known bot patterns
 */
export function isBot(userAgent: string): boolean {
    if (!userAgent) return false;

    const ua = userAgent.toLowerCase();

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

        // Generic bot indicators (use boundary-aware patterns to avoid
        // false positives on real browsers — e.g. bare 'bot' matches 'About')
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
    if (!ip) return '';

    // Handle IPv4
    if (ip.includes('.') && !ip.includes(':')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            parts[3] = 'xxx';
            return parts.join('.');
        }
    }

    // Handle IPv6 (or IPv4-mapped IPv6)
    if (ip.includes(':')) {
        const parts = ip.split(':');
        // Mask last 5 segments (80 bits) for IPv6
        if (parts.length >= 5) {
            const maskedParts = parts.slice(0, Math.max(3, parts.length - 5));
            maskedParts.push('xxxx');
            return maskedParts.join(':');
        }
    }

    // Fallback: mask last 5 characters
    if (ip.length > 5) {
        return ip.substring(0, ip.length - 5) + 'xxxxx';
    }

    return 'xxx.xxx.xxx.xxx';
}
