/**
 * Crawler Identity Registry.
 *
 * Maps known bot/crawler user-agent patterns to rich identity metadata.
 * Pure data — no runtime cost unless actively queried after isBot() returns true.
 */

/** Why: Categories group crawlers for filtering in the dashboard UI. */
export type CrawlerCategory =
    | 'search_engine'
    | 'ai_crawler'
    | 'seo_tool'
    | 'social_preview'
    | 'monitor'
    | 'security_scanner'
    | 'http_client'
    | 'unknown';

/** Why: Intent signal helps admins decide whether blocking is safe. */
export type CrawlerIntent = 'beneficial' | 'neutral' | 'harmful';

export interface CrawlerIdentity {
    /** Display name: "Googlebot" */
    name: string;
    /** Lowercase slug used as DB key: "googlebot" */
    slug: string;
    /** UA substrings to match (all lowercase) */
    patterns: string[];
    category: CrawlerCategory;
    /** Organization operating the crawler */
    owner: string;
    /** Human-readable purpose description */
    description: string;
    /** Link to official bot documentation */
    website: string;
    intent: CrawlerIntent;
}

/**
 * Why: Display-friendly labels and colors for each category.
 * Used by both API responses and the frontend.
 */
export const CATEGORY_META: Record<CrawlerCategory, { label: string; emoji: string }> = {
    search_engine: { label: 'Search Engine', emoji: '🔍' },
    ai_crawler: { label: 'AI Crawler', emoji: '🤖' },
    seo_tool: { label: 'SEO Tool', emoji: '📊' },
    social_preview: { label: 'Social Preview', emoji: '🔗' },
    monitor: { label: 'Uptime Monitor', emoji: '📡' },
    security_scanner: { label: 'Security Scanner', emoji: '🛡️' },
    http_client: { label: 'HTTP Client', emoji: '⚙️' },
    unknown: { label: 'Unknown', emoji: '❓' },
};

/**
 * Registry of known crawlers.
 * Patterns must be lowercase — matching is done against lowercased UA strings.
 */
export const CRAWLER_REGISTRY: CrawlerIdentity[] = [
    // ── Search Engines ─────────────────────────────────────────────────
    {
        name: 'Googlebot', slug: 'googlebot', patterns: ['googlebot'],
        category: 'search_engine', owner: 'Google LLC',
        description: 'Primary web search crawler. Essential for Google Search indexing.',
        website: 'https://developers.google.com/search/docs/crawling-indexing/googlebot',
        intent: 'beneficial',
    },
    {
        name: 'Bingbot', slug: 'bingbot', patterns: ['bingbot'],
        category: 'search_engine', owner: 'Microsoft',
        description: 'Microsoft Bing search crawler.',
        website: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use',
        intent: 'beneficial',
    },
    {
        name: 'Yahoo Slurp', slug: 'slurp', patterns: ['slurp'],
        category: 'search_engine', owner: 'Yahoo / Verizon Media',
        description: 'Yahoo search engine crawler.',
        website: 'https://help.yahoo.com/kb/search/slurp-crawling-page-sln22600.html',
        intent: 'beneficial',
    },
    {
        name: 'DuckDuckBot', slug: 'duckduckbot', patterns: ['duckduckbot'],
        category: 'search_engine', owner: 'DuckDuckGo',
        description: 'DuckDuckGo privacy-focused search crawler.',
        website: 'https://duckduckgo.com/duckduckbot',
        intent: 'beneficial',
    },
    {
        name: 'Baiduspider', slug: 'baiduspider', patterns: ['baiduspider'],
        category: 'search_engine', owner: 'Baidu Inc.',
        description: 'Chinese search engine crawler.',
        website: 'https://www.baidu.com/search/robots_english.html',
        intent: 'beneficial',
    },
    {
        name: 'YandexBot', slug: 'yandexbot', patterns: ['yandexbot'],
        category: 'search_engine', owner: 'Yandex',
        description: 'Russian search engine crawler.',
        website: 'https://yandex.com/support/webmaster/robot-workings/check-yandex-robots.html',
        intent: 'beneficial',
    },
    {
        name: 'Sogou Spider', slug: 'sogou', patterns: ['sogou'],
        category: 'search_engine', owner: 'Sogou / Tencent',
        description: 'Chinese search engine crawler.',
        website: 'https://www.sogou.com/',
        intent: 'neutral',
    },
    {
        name: 'Applebot', slug: 'applebot', patterns: ['applebot'],
        category: 'search_engine', owner: 'Apple Inc.',
        description: 'Apple search and Siri Suggestions crawler.',
        website: 'https://support.apple.com/en-us/111855',
        intent: 'beneficial',
    },

    // ── Google Specialty Bots ─────────────────────────────────────────
    {
        name: 'AdsBot-Google', slug: 'adsbot-google', patterns: ['adsbot-google', 'adsbot/3'],
        category: 'search_engine', owner: 'Google LLC',
        description: 'Checks landing page quality for Google Ads campaigns.',
        website: 'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
        intent: 'beneficial',
    },
    {
        name: 'Feedfetcher-Google', slug: 'feedfetcher-google', patterns: ['feedfetcher-google'],
        category: 'search_engine', owner: 'Google LLC',
        description: 'Fetches RSS/Atom feeds for Google Podcasts and News.',
        website: 'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
        intent: 'beneficial',
    },
    {
        name: 'Storebot-Google', slug: 'storebot-google', patterns: ['storebot-google', 'storebot'],
        category: 'search_engine', owner: 'Google LLC',
        description: 'Crawls product pages for Google Shopping and Merchant Center.',
        website: 'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
        intent: 'beneficial',
    },
    {
        name: 'BingIndexCrawler', slug: 'bingindexcrawler', patterns: ['bingindexcrawler', 'bingindex'],
        category: 'search_engine', owner: 'Microsoft',
        description: 'Microsoft Bing supplemental indexing crawler.',
        website: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use',
        intent: 'beneficial',
    },

    // ── AI Crawlers ────────────────────────────────────────────────────
    {
        name: 'DuckAssistBot', slug: 'duckassistbot', patterns: ['duckassistbot'],
        category: 'ai_crawler', owner: 'DuckDuckGo',
        description: 'Fetches content for DuckDuckGo AI-assisted search answers.',
        website: 'https://duckduckgo.com/duckduckbot',
        intent: 'neutral',
    },
    {
        name: 'GPTBot', slug: 'gptbot', patterns: ['gptbot', 'chatgpt-user'],
        category: 'ai_crawler', owner: 'OpenAI',
        description: 'Crawls pages for AI training data. Can be blocked without SEO impact.',
        website: 'https://platform.openai.com/docs/gptbot',
        intent: 'neutral',
    },
    {
        name: 'ClaudeBot', slug: 'claudebot', patterns: ['claudebot', 'anthropic-ai'],
        category: 'ai_crawler', owner: 'Anthropic',
        description: 'Crawls pages for AI training. Can be blocked without SEO impact.',
        website: 'https://docs.anthropic.com',
        intent: 'neutral',
    },
    {
        name: 'CCBot', slug: 'ccbot', patterns: ['ccbot'],
        category: 'ai_crawler', owner: 'Common Crawl Foundation',
        description: 'Open web archive crawler used by many AI training datasets.',
        website: 'https://commoncrawl.org/faq',
        intent: 'neutral',
    },
    {
        name: 'Bytespider', slug: 'bytespider', patterns: ['bytespider'],
        category: 'ai_crawler', owner: 'ByteDance / TikTok',
        description: 'ByteDance AI training crawler. Known for aggressive crawl rates.',
        website: 'https://www.bytedance.com/',
        intent: 'neutral',
    },
    {
        name: 'PetalBot', slug: 'petalbot', patterns: ['petalbot'],
        category: 'ai_crawler', owner: 'Huawei / Aspiegel',
        description: 'Huawei Petal Search and AI crawler.',
        website: 'https://aspiegel.com/petalbot',
        intent: 'neutral',
    },
    {
        name: 'AmazonBot', slug: 'amazonbot', patterns: ['amazonbot'],
        category: 'ai_crawler', owner: 'Amazon',
        description: 'Amazon Alexa and product indexing crawler.',
        website: 'https://developer.amazon.com/amazonbot',
        intent: 'neutral',
    },
    {
        name: 'Cohere AI', slug: 'cohere-ai', patterns: ['cohere-ai'],
        category: 'ai_crawler', owner: 'Cohere',
        description: 'Cohere AI model training crawler.',
        website: 'https://cohere.com',
        intent: 'neutral',
    },

    // ── SEO Tools ──────────────────────────────────────────────────────
    {
        name: 'AhrefsBot', slug: 'ahrefsbot', patterns: ['ahrefs'],
        category: 'seo_tool', owner: 'Ahrefs Pte. Ltd.',
        description: 'Backlink analysis and SEO auditing crawler.',
        website: 'https://ahrefs.com/robot',
        intent: 'neutral',
    },
    {
        name: 'SEMrush Bot', slug: 'semrushbot', patterns: ['semrush'],
        category: 'seo_tool', owner: 'Semrush Inc.',
        description: 'SEO competitive analysis crawler.',
        website: 'https://www.semrush.com/bot/',
        intent: 'neutral',
    },
    {
        name: 'DotBot', slug: 'dotbot', patterns: ['dotbot'],
        category: 'seo_tool', owner: 'Moz Inc.',
        description: 'Moz link-building and SEO analysis crawler.',
        website: 'https://moz.com/help/moz-procedures/crawlers/dotbot',
        intent: 'neutral',
    },
    {
        name: 'RogerBot', slug: 'rogerbot', patterns: ['rogerbot'],
        category: 'seo_tool', owner: 'Moz Inc.',
        description: 'Moz site crawling bot for link analysis.',
        website: 'https://moz.com/help/moz-procedures/crawlers/rogerbot',
        intent: 'neutral',
    },
    {
        name: 'Screaming Frog', slug: 'screaming-frog', patterns: ['screaming frog'],
        category: 'seo_tool', owner: 'Screaming Frog Ltd.',
        description: 'Website audit and SEO spider tool.',
        website: 'https://www.screamingfrog.co.uk/seo-spider/',
        intent: 'neutral',
    },
    {
        name: 'SiteBulb', slug: 'sitebulb', patterns: ['sitebulb'],
        category: 'seo_tool', owner: 'SiteBulb Ltd.',
        description: 'Website auditing crawler.',
        website: 'https://sitebulb.com/',
        intent: 'neutral',
    },
    {
        name: 'DeepCrawl', slug: 'deepcrawl', patterns: ['deepcrawl'],
        category: 'seo_tool', owner: 'Lumar (DeepCrawl)',
        description: 'Enterprise website intelligence crawler.',
        website: 'https://www.lumar.io/',
        intent: 'neutral',
    },

    // ── Social Preview / Link Unfurlers ────────────────────────────────
    {
        name: 'Facebook Bot', slug: 'facebot', patterns: ['facebot', 'facebookexternalhit'],
        category: 'social_preview', owner: 'Meta Platforms',
        description: 'Generates link previews for Facebook and Messenger shares.',
        website: 'https://developers.facebook.com/docs/sharing/webmasters/crawler',
        intent: 'beneficial',
    },
    {
        name: 'Twitterbot', slug: 'twitterbot', patterns: ['twitterbot'],
        category: 'social_preview', owner: 'X Corp.',
        description: 'Generates Twitter/X card previews when links are shared.',
        website: 'https://developer.x.com/en/docs/twitter-for-websites/cards/guides/getting-started',
        intent: 'beneficial',
    },
    {
        name: 'LinkedInBot', slug: 'linkedinbot', patterns: ['linkedinbot'],
        category: 'social_preview', owner: 'LinkedIn / Microsoft',
        description: 'Generates link previews for LinkedIn post shares.',
        website: 'https://www.linkedin.com/',
        intent: 'beneficial',
    },
    {
        name: 'Slackbot', slug: 'slackbot', patterns: ['slackbot'],
        category: 'social_preview', owner: 'Salesforce (Slack)',
        description: 'Generates link previews in Slack channels.',
        website: 'https://api.slack.com/robots',
        intent: 'beneficial',
    },
    {
        name: 'Discord Bot', slug: 'discordbot', patterns: ['discordbot'],
        category: 'social_preview', owner: 'Discord Inc.',
        description: 'Generates link previews in Discord messages.',
        website: 'https://discord.com/',
        intent: 'beneficial',
    },
    {
        name: 'Telegram Bot', slug: 'telegrambot', patterns: ['telegrambot'],
        category: 'social_preview', owner: 'Telegram Messenger',
        description: 'Generates link previews in Telegram chats.',
        website: 'https://telegram.org/',
        intent: 'beneficial',
    },
    {
        name: 'WhatsApp', slug: 'whatsapp', patterns: ['whatsapp'],
        category: 'social_preview', owner: 'Meta Platforms',
        description: 'Generates link previews in WhatsApp messages.',
        website: 'https://www.whatsapp.com/',
        intent: 'beneficial',
    },

    {
        name: 'Snapchat URL Preview', slug: 'snapchat-preview', patterns: ['snap url preview', 'snapchat'],
        category: 'social_preview', owner: 'Snap Inc.',
        description: 'Generates link previews when URLs are shared on Snapchat.',
        website: 'https://www.snapchat.com/',
        intent: 'beneficial',
    },
    {
        name: 'PeecBot', slug: 'peecbot', patterns: ['peecbot'],
        category: 'seo_tool', owner: 'Peec.ai',
        description: 'SEO monitoring and crawling bot.',
        website: 'https://peec.ai/',
        intent: 'neutral',
    },

    // ── Security Scanners (additional) ────────────────────────────────
    {
        name: 'Palo Alto Networks', slug: 'palo-alto-scanner', patterns: ['palo alto networks', 'paloaltonetworks', 'palo_alto'],
        category: 'security_scanner', owner: 'Palo Alto Networks',
        description: 'Security research and threat intelligence scanner.',
        website: 'https://www.paloaltonetworks.com/',
        intent: 'neutral',
    },
    {
        name: 'DomainAuditor', slug: 'domainauditor', patterns: ['domainauditor'],
        category: 'seo_tool', owner: 'DomainAuditor',
        description: 'Domain and website auditing crawler.',
        website: '',
        intent: 'neutral',
    },

    // ── HTTP Clients (additional) ─────────────────────────────────────
    {
        name: 'SEBot', slug: 'sebot', patterns: ['sebot'],
        category: 'seo_tool', owner: 'Unknown',
        description: 'Search engine optimization bot.',
        website: '',
        intent: 'neutral',
    },
    {
        name: 'Python aiohttp', slug: 'python-aiohttp', patterns: ['aiohttp'],
        category: 'http_client', owner: 'Open Source',
        description: 'Python async HTTP client library.',
        website: 'https://docs.aiohttp.org/',
        intent: 'neutral',
    },

    // ── Uptime Monitors ────────────────────────────────────────────────
    {
        name: 'Pingdom', slug: 'pingdom', patterns: ['pingdom'],
        category: 'monitor', owner: 'SolarWinds',
        description: 'Website uptime and performance monitoring.',
        website: 'https://www.pingdom.com/',
        intent: 'beneficial',
    },
    {
        name: 'UptimeRobot', slug: 'uptimerobot', patterns: ['uptimerobot'],
        category: 'monitor', owner: 'UptimeRobot',
        description: 'Free uptime monitoring service.',
        website: 'https://uptimerobot.com/',
        intent: 'beneficial',
    },
    {
        name: 'StatusCake', slug: 'statuscake', patterns: ['statuscake'],
        category: 'monitor', owner: 'StatusCake',
        description: 'Website monitoring and alerting.',
        website: 'https://www.statuscake.com/',
        intent: 'beneficial',
    },
    {
        name: 'GTmetrix', slug: 'gtmetrix', patterns: ['gtmetrix'],
        category: 'monitor', owner: 'GTmetrix',
        description: 'Page speed and performance testing.',
        website: 'https://gtmetrix.com/',
        intent: 'beneficial',
    },
    {
        name: 'Site24x7', slug: 'site24x7', patterns: ['site24x7'],
        category: 'monitor', owner: 'Zoho Corp.',
        description: 'Infrastructure and website monitoring.',
        website: 'https://www.site24x7.com/',
        intent: 'beneficial',
    },

    // ── Security Scanners ──────────────────────────────────────────────
    {
        name: 'Nmap', slug: 'nmap', patterns: ['nmap'],
        category: 'security_scanner', owner: 'Open Source',
        description: 'Network discovery and security auditing tool.',
        website: 'https://nmap.org/',
        intent: 'harmful',
    },
    {
        name: 'Nikto', slug: 'nikto', patterns: ['nikto'],
        category: 'security_scanner', owner: 'Open Source',
        description: 'Web server vulnerability scanner.',
        website: 'https://cirt.net/Nikto2',
        intent: 'harmful',
    },
    {
        name: 'SQLMap', slug: 'sqlmap', patterns: ['sqlmap'],
        category: 'security_scanner', owner: 'Open Source',
        description: 'Automated SQL injection detection tool.',
        website: 'https://sqlmap.org/',
        intent: 'harmful',
    },

    // ── HTTP Clients ───────────────────────────────────────────────────
    {
        name: 'cURL', slug: 'curl', patterns: ['curl'],
        category: 'http_client', owner: 'Open Source',
        description: 'Command-line HTTP client. Common in automated scripts.',
        website: 'https://curl.se/',
        intent: 'neutral',
    },
    {
        name: 'Wget', slug: 'wget', patterns: ['wget'],
        category: 'http_client', owner: 'GNU Project',
        description: 'Command-line file downloader. Used for mirroring sites.',
        website: 'https://www.gnu.org/software/wget/',
        intent: 'neutral',
    },
    {
        name: 'Python Requests', slug: 'python-requests', patterns: ['python-requests', 'python-urllib'],
        category: 'http_client', owner: 'Open Source',
        description: 'Python HTTP library. Used in scripts and scrapers.',
        website: 'https://docs.python-requests.org/',
        intent: 'neutral',
    },
    {
        name: 'Go HTTP Client', slug: 'go-http-client', patterns: ['go-http-client'],
        category: 'http_client', owner: 'Open Source',
        description: 'Go standard library HTTP client.',
        website: 'https://pkg.go.dev/net/http',
        intent: 'neutral',
    },
    {
        name: 'Headless Chrome', slug: 'headless', patterns: ['headlesschrome'],
        category: 'http_client', owner: 'Various',
        description: 'Headless browser automation. May be scraping or testing.',
        website: 'https://developer.chrome.com/docs/chromium/headless',
        intent: 'neutral',
    },
    {
        name: 'Puppeteer', slug: 'puppeteer', patterns: ['puppeteer'],
        category: 'http_client', owner: 'Google Chrome Team',
        description: 'Node.js browser automation library.',
        website: 'https://pptr.dev/',
        intent: 'neutral',
    },
    {
        name: 'Playwright', slug: 'playwright', patterns: ['playwright'],
        category: 'http_client', owner: 'Microsoft',
        description: 'Cross-browser automation framework.',
        website: 'https://playwright.dev/',
        intent: 'neutral',
    },
    {
        name: 'Selenium', slug: 'selenium', patterns: ['selenium'],
        category: 'http_client', owner: 'Open Source',
        description: 'Browser automation framework for testing.',
        website: 'https://www.selenium.dev/',
        intent: 'neutral',
    },
];
