(function (window, document) {
    'use strict';
    function start() {
        if (!window.overseekDelivery || !window.fetch || !window.AbortController) return;
        let timer, generation = 0, controller;
        const selector = '.os-delivery-placeholder[data-product-id][data-request-id]';
        const nodes = () => Array.from(document.querySelectorAll(selector));
        function schedule() {
            generation += 1; // Invalidate immediately, including the debounce interval.
            if (controller) controller.abort();
            window.clearTimeout(timer);
            nodes().forEach(node => { node.textContent = ''; });
            timer = window.setTimeout(refresh, 180);
        }
        function matchingForm(node) {
            const id = node.dataset.productId;
            const matches = form => {
                const ids = [form.dataset.product_id, form.dataset.productId];
                form.querySelectorAll('[name="product_id"], [name="add-to-cart"]').forEach(input => ids.push(input.value));
                const known = ids.filter(value => value !== undefined && value !== null && value !== '');
                return known.length > 0 && known.every(value => /^[1-9]\d*$/.test(String(value)) && String(value) === id);
            };
            const enclosing = node.closest('form.cart');
            if (enclosing) return matches(enclosing) ? enclosing : null;
            const scope = node.closest('.product');
            const local = scope ? Array.from(scope.querySelectorAll('form.cart')).filter(matches) : [];
            if (local.length) return local.length === 1 ? local[0] : null;
            // No first-form fallback: identical product cards are ambiguous outside their scope.
            const page = Array.from(document.querySelectorAll('form.cart')).filter(matches);
            return page.length === 1 ? page[0] : null;
        }
        function identity(node) {
            const form = matchingForm(node);
            const quantity = form && form.querySelector('[name="quantity"]');
            const variation = form && form.querySelector('[name="variation_id"]');
            const integer = (value, max) => /^[1-9]\d*$/.test(String(value)) && Number(value) <= max ? Number(value) : 0;
            return {
                request_id: node.dataset.requestId,
                product_id: integer(node.dataset.productId, 2147483647),
                variation_id: variation ? integer(variation.value, 2147483647) : 0,
                quantity: quantity ? integer(quantity.value, 1000000) : 1
            };
        }
        async function refresh() {
            const version = generation;
            controller = new window.AbortController();
            const signal = controller.signal;
            const entries = nodes().map(node => ({ node, item: identity(node) }));
            // At most 20 per bounded request; sequential chunks avoid a burst on collections.
            for (let offset = 0; offset < entries.length; offset += 20) {
                if (version !== generation) return;
                const batch = entries.slice(offset, offset + 20);
                try {
                    const response = await window.fetch(window.overseekDelivery.url, {
                        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ items: batch.map(entry => entry.item) })
                    });
                    if (!response.ok) return;
                    const data = await response.json();
                    if (version !== generation || signal.aborted) return;
                    if (!Array.isArray(data.items)) return;
                    batch.forEach(({ node, item }) => {
                        const row = data.items.find(row => row.request_id === item.request_id &&
                            row.product_id === item.product_id && row.variation_id === item.variation_id);
                        if (row && typeof row.html === 'string') node.innerHTML = row.html;
                    });
                } catch (_) { return; } // A failed read leaves a blank estimate.
            }
        }
        ['input', 'change'].forEach(event => document.addEventListener(event, function (event) {
            if (event.target.matches('[name="quantity"], [name="variation_id"], .variations select')) schedule();
        }));
        // Woo's variation events are jQuery-only. No jQuery dependency is introduced.
        if (window.jQuery) window.jQuery(document).on(
            'found_variation.overseekDelivery reset_data.overseekDelivery hide_variation.overseekDelivery',
            'form.variations_form', schedule);
        schedule();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}(window, document));
