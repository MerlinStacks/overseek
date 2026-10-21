import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Execute the actual inline listener emitted by PHP, not a duplicate implementation.
const source = readFileSync(resolve(__dirname, '../../../../../overseek-wc-plugin/includes/class-overseek-pixels.php'), 'utf8');
const listener = source.slice(source.indexOf('return <<<JS', source.indexOf('private function build_add_to_cart_listener')) + 'return <<<JS'.length).split('\nJS;')[0]
    .replace('{$platforms}', JSON.stringify({ meta: true }))
    .replaceAll('{$this->get_currency_code()}', 'AUD');

describe('storefront Meta AddToCart IDs', () => {
    let handlers: Record<string, (...args: any[]) => any>;
    let fbq: ReturnType<typeof vi.fn>;
    let button: any;
    beforeEach(() => {
        handlers = {};
        fbq = vi.fn();
        let sequence = 0;
        const attrs: Record<string, string> = { href: '/?add-to-cart=10&overseek_event_id=old-id' };
        const data: Record<string, any> = { product_id: 10, product_price: 12.5, quantity: 3 };
        button = {
            attr: (key: string, value?: string) => value === undefined ? attrs[key] : (attrs[key] = value, button),
            data: (key: string, value?: any) => value === undefined ? data[key] : (data[key] = value, button),
            hasClass: (name: string) => name === 'ajax_add_to_cart',
        };
        const target = { on: (event: string, ...args: any[]) => { handlers[event] = args.at(-1); return target; } };
        const jQuery = (value: unknown) => value === button ? button : target;
        const window = { jQuery, location: { href: 'https://shop.test/' }, crypto: { randomUUID: () => `event-${++sequence}` }, overseekAdvertisingConsentGranted: true, fbq };
        runInNewContext(listener, { window, document: { body: {} }, URL, fbq });
    });

    it('shares the pre-request ID with the server POST and the successful browser event', () => {
        const request: Record<string, any> = {};
        handlers.adding_to_cart({}, button, request);
        expect(fbq).not.toHaveBeenCalled();
        handlers.added_to_cart({}, {}, '', button);
        expect(request.overseek_event_id).toBe('event-1');
        expect(button.data('overseek_event_id')).toBe(request.overseek_event_id);
        expect(fbq).toHaveBeenCalledWith('track', 'AddToCart', expect.objectContaining({ value: 37.5, currency: 'AUD' }), { eventID: request.overseek_event_id });
    });

    it('assigns a new matching ID for every repeated add from the same button', () => {
        const first: Record<string, any> = {};
        const second: Record<string, any> = {};
        handlers.adding_to_cart({}, button, first);
        handlers.added_to_cart({}, {}, '', button);
        handlers.adding_to_cart({}, button, second);
        handlers.added_to_cart({}, {}, '', button);
        expect(first.overseek_event_id).not.toBe(second.overseek_event_id);
        expect(fbq.mock.calls.map(call => call[3].eventID)).toEqual([first.overseek_event_id, second.overseek_event_id]);
        const href = new URL(button.attr('href'));
        expect(href.searchParams.getAll('overseek_event_id')).toEqual([second.overseek_event_id]);
    });

    it('does not overwrite the AJAX request ID in the later document click handler', () => {
        const request: Record<string, any> = {};
        handlers.adding_to_cart({}, button, request);
        handlers.click.call(button);
        handlers.added_to_cart({}, {}, '', button);
        expect(fbq.mock.calls[0][3].eventID).toBe(request.overseek_event_id);
    });

    it('replaces stale IDs on non-AJAX links before navigation', () => {
        button.hasClass = () => false;
        handlers.click.call(button);
        const first = button.attr('data-overseek-event-id');
        handlers.click.call(button);
        const second = button.attr('data-overseek-event-id');
        expect(second).not.toBe(first);
        expect(new URL(button.attr('href')).searchParams.getAll('overseek_event_id')).toEqual([second]);
    });
});
