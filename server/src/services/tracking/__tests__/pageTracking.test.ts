import { describe, expect, it } from 'vitest';
import { currentPageUpdate, isTrackablePageUrl, PAGE_VIEW_TYPES } from '../pageTracking';

describe('shared page classification', () => {
    it.each([
        '', ' ', '/?wc-ajax=add_to_cart', '?wc-ajax=wcpa_ajax_add_to_cart',
        '/?x=1&WC-AJAX=checkout', '/?rest_route=/wc/store/v1/cart', '/?wc-api=payment_callback',
        '/wp-json/wc/store/v1/cart', '/subdirectory/wp-json/wp/v2/posts',
        '/wp-admin/admin-ajax.php', '/wp-login.php', '/wp-cron.php', '/xmlrpc.php',
        '/feed/', '/?feed=rss2', '/category/gifts/feed/', '/sitemap.xml', '/robots.txt',
        'https://shop.test/assets/app.JS?v=1#hash', '/photo.webp', '/price-list.pdf',
    ])('rejects non-document URL %j', url => {
        expect(isTrackablePageUrl(url)).toBe(false);
        for (const type of PAGE_VIEW_TYPES) expect(currentPageUpdate(type, url)).toEqual({});
    });

    it.each([
        '/', '/cart/', '/checkout/?coupon=gift', '/?s=flowers',
        '/product/gift/?variation_id=123&attribute_pa_colour=red',
        '/product/gift/?utm_source=google&gclid=123', '/?not-wc-ajax=1',
        '/#?wc-ajax=add_to_cart', 'https://shop.test/', '/product/wp-json-print/',
    ])('accepts real page URL %s', url => {
        expect(isTrackablePageUrl(url)).toBe(true);
        for (const type of PAGE_VIEW_TYPES) expect(currentPageUpdate(type, url)).toEqual({ currentPath: url });
    });

    it.each(['add_to_cart', 'remove_from_cart', 'purchase', 'checkout_start', 'heartbeat'])(
        '%s never overwrites the last known page', type => {
            expect(currentPageUpdate(type, '/?wc-ajax=add_to_cart')).toEqual({});
            expect(currentPageUpdate(type, '/cart/')).toEqual({});
        }
    );
});
