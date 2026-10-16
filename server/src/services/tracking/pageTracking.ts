import { Prisma } from '@prisma/client';

export const PAGE_VIEW_TYPES = ['pageview', 'product_view', 'cart_view', 'checkout_view'];

// Shared by ingestion and SQL reports so historical noise is excluded too.
export const NON_PAGE_QUERY_PATTERN = '(^|&)(wc-ajax|wc-api|rest_route|feed)(=|&|$)';
export const NON_PAGE_PATH_PATTERN = '(^|/)(wp-admin(/|$)|wp-login[.]php$|wp-json(/|$)|xmlrpc[.]php$|wp-cron[.]php$)|/feed(/|$)|[.](js|css|map|jpg|jpeg|png|gif|svg|webp|ico|bmp|avif|woff|woff2|ttf|eot|otf|mp4|webm|mp3|ogg|wav|pdf|doc|docx|xls|xlsx|zip|tar|gz|rar|xml|json|txt)$';
export const TRACKING_KEY_PATTERN = '^(utm_.*|mtm_.*|gad_.*|gclid|dclid|gclsrc|gbraid|wbraid|fbclid|msclkid|ttclid|twclid|yclid|srsltid|mc_cid|mc_eid|_ga|_gl)$';

export function isTrackablePageUrl(url: string): boolean {
    if (!url?.trim()) return false;
    const [path, query = ''] = url.trim().split('#')[0].split('?');
    return !new RegExp(NON_PAGE_QUERY_PATTERN, 'i').test(query)
        && !new RegExp(NON_PAGE_PATH_PATTERN, 'i').test(path.replace(/^https?:\/\/[^/]+/i, ''));
}

/** Only actual page events may replace the live visitor's current page. */
export function currentPageUpdate(type: string, url: string): { currentPath?: string } {
    return PAGE_VIEW_TYPES.includes(type) && isTrackablePageUrl(url) ? { currentPath: url } : {};
}

/** Fixed alias e; never interpolate identifiers or user-supplied SQL. */
export const pageEventFilter = Prisma.sql`
    e.type IN (${Prisma.join(PAGE_VIEW_TYPES)})
    AND NULLIF(BTRIM(e.url), '') IS NOT NULL
    AND split_part(split_part(e.url, '#', 1), '?', 2) !~* ${NON_PAGE_QUERY_PATTERN}
    AND regexp_replace(split_part(split_part(BTRIM(e.url), '#', 1), '?', 1), '^https?://[^/]+', '', 'i') !~* ${NON_PAGE_PATH_PATTERN}
`;

// Keep raw URLs and attribution on stored events. Only report grouping changes.
export const reportPageUrl = Prisma.sql`
    split_part(split_part(e.url, '#', 1), '?', 1)
    || COALESCE('?' || (
        SELECT string_agg(parameter, '&' ORDER BY position)
        FROM regexp_split_to_table(split_part(split_part(e.url, '#', 1), '?', 2), '&')
            WITH ORDINALITY AS parts(parameter, position)
        WHERE parameter <> ''
        AND split_part(parameter, '=', 1) !~* ${TRACKING_KEY_PATTERN}
    ), '')
`;
