/* Public context survives page caching; identity, attribution and IDs belong to each visit. */
(function () {
    'use strict';
    if (!window.overseekViews || window.__overseekViewCollector) return;
    window.__overseekViewCollector = true;
    var config = window.overseekViews;
    var ids = window.__overseekViewIds = window.__overseekViewIds || {};
    window.overseekGetViewEventId = window.overseekGetViewEventId || function (key) {
        if (!ids[key]) ids[key] = 'os_view_' + (window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID().replace(/-/g, '')
            : Date.now().toString(36) + Math.random().toString(36).slice(2));
        return ids[key];
    };
    var sent = false;
    function send() {
        if (sent || document.prerendering || document.visibilityState === 'hidden') return;
        if (config.requiresConsent && !(typeof window.wp_has_consent === 'function' && window.wp_has_consent('marketing'))) return;
        sent = true;
        var key = Number(config.productId) ? 'product:' + config.productId : (config.search ? 'search' : 'page');
        var url = new URL(window.location.href);
        url.hash = '';
        var body = new URLSearchParams({ context: config.context, signature: config.signature,
            url: url.href, referrer: document.referrer || '', title: document.title.slice(0, 500),
            eventId: window.overseekGetViewEventId(key) });
        fetch(config.endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
            keepalive: true, body: body }).catch(function () { /* Analytics must not interrupt shopping. */ });
    }
    document.addEventListener('wp_listen_for_consent_change', send);
    document.addEventListener('visibilitychange', send);
    document.addEventListener('prerenderingchange', send);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', send, { once: true });
    else send();
})();
