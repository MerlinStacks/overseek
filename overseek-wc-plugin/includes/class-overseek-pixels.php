<?php
/**
 * Client-Side Pixel Injection
 *
 * Injects ad platform pixel base codes and fires conversion events based on
 * config fetched from the OverSeek API. Works alongside server-side CAPI for
 * full hybrid tracking (browser + server deduplication via eventId).
 *
 * Supports: Meta, TikTok, GA4, Google Ads, Pinterest, Snapchat, Microsoft/Bing, Twitter/X.
 * Also handles Google Consent Mode v2 with auto-accept support.
 *
 * @package OverSeek
 * @since   2.5.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

class OverSeek_Pixels
{
    /** @var string */
    private $api_url;

    /** @var string */
    private $account_id;

    /** @var array<string, mixed>|null Cached pixel config */
    private $config = null;

    public function __construct()
    {
        $this->api_url = untrailingslashit(get_option('overseek_api_url', ''));
        $this->account_id = get_option('overseek_account_id', '');

        if (empty($this->account_id) || empty($this->api_url)) {
            return;
        }

        if (is_admin() || defined('REST_REQUEST') || wp_doing_ajax()) {
            return;
        }

        add_action('wp_head', array($this, 'inject_base_codes'), 1);
        add_action('wp_footer', array($this, 'inject_page_events'), 50);

        // Background refresh handler for stale-while-revalidate caching
        add_action('overseek_refresh_pixel_config', array($this, 'handle_background_refresh'));
    }

    /**
     * WP-Cron callback: refresh pixel config in the background (non-blocking).
     */
    public function handle_background_refresh(string $account_id = ''): void
    {
        if (empty($account_id)) $account_id = $this->account_id;
        if (empty($account_id) || empty($this->api_url)) return;
        $this->fetch_pixel_config_from_api();
    }

    /**
     * Inject pixel base codes into <head>.
     * Includes Google Consent Mode v2 defaults BEFORE any Google tags.
     */
    public function inject_base_codes(): void
    {
        $config = $this->get_pixel_config();
        if (empty($config)) return;

        echo "\n<!-- OverSeek Tracking Pixels v" . esc_html(OVERSEEK_WC_VERSION) . " -->\n";

        // ─── Google Consent Mode v2 ──────────────────────────────────────
        // Must come BEFORE any gtag/fbq/ttq scripts.
        $this->inject_consent_mode($config);

        // ─── Meta Pixel ─────────────────────────────────────────────────
        if (!empty($config['meta']['pixelId'])) {
            $pixel_id = esc_js($config['meta']['pixelId']);
            $init_params = $this->get_advanced_matching_params($config['meta']);

            // Add external_id for improved Event Match Quality
            $external_id = $this->get_external_id();
            if ($external_id && !empty($config['meta']['advancedMatching'])) {
                $init_params['external_id'] = hash('sha256', strtolower(trim($external_id)));
            }

            echo "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');";
            if (!empty($init_params)) {
                echo "fbq('init','{$pixel_id}'," . wp_json_encode($init_params) . ");";
            } else {
                echo "fbq('init','{$pixel_id}');";
            }
            echo "</script>\n";
            echo '<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=' . esc_attr($pixel_id) . '&ev=PageView&noscript=1"/></noscript>' . "\n";
        }

        // ─── TikTok Pixel + Advanced Matching ───────────────────────────
        if (!empty($config['tiktok']['pixelCode'])) {
            $pixel_code = esc_js($config['tiktok']['pixelCode']);
            echo "<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie','holdConsent','revokeConsent','grantConsent'],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r='https://analytics.tiktok.com/i18n/pixel/events.js',o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e+\"_\"+o]=1;var a=d.createElement('script');a.type='text/javascript';a.async=!0;a.src=r+'?sdkid='+e+'&lib='+t;var s=d.getElementsByTagName('script')[0];s.parentNode.insertBefore(a,s)};ttq.load('{$pixel_code}');ttq.page();";

            // TikTok Advanced Matching — send hashed PII for better match rates
            if (!empty($config['tiktok']['advancedMatching'])) {
                $tt_identify = $this->get_tiktok_identify_params();
                if (!empty($tt_identify)) {
                    echo "ttq.identify(" . wp_json_encode($tt_identify) . ");";
                }
            }
            echo "}(window,document,'ttq');</script>\n";
        }

        // ─── Google Analytics 4 + Google Ads (shared gtag.js) ───────────
        $ga4_id = $config['ga4']['measurementId'] ?? '';
        $gads_id = $config['google']['conversionId'] ?? '';
        $gtag_primary = $ga4_id ?: $gads_id;
        if (!empty($gtag_primary)) {
            echo '<script async src="https://www.googletagmanager.com/gtag/js?id=' . esc_attr($gtag_primary) . '"></script>' . "\n";
            // gtag() and dataLayer already defined by consent mode above — only add js init + config calls
            echo "<script>gtag('js',new Date());";
            if (!empty($ga4_id)) echo "gtag('config','" . esc_js($ga4_id) . "');";
            if (!empty($gads_id)) echo "gtag('config','" . esc_js($gads_id) . "');";
            echo "</script>\n";
        }

        // ─── Pinterest Tag ──────────────────────────────────────────────
        if (!empty($config['pinterest']['tagId'])) {
            $tag_id = esc_js($config['pinterest']['tagId']);
            echo "<script>!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version='3.0';var t=document.createElement('script');t.async=!0,t.src=e;var r=document.getElementsByTagName('script')[0];r.parentNode.insertBefore(t,r)}}('https://s.pinimg.com/ct/core.js');pintrk('load','{$tag_id}');pintrk('page');</script>\n";
            echo '<noscript><img height="1" width="1" style="display:none" src="https://ct.pinterest.com/v3/?event=init&tid=' . esc_attr($tag_id) . '&noscript=1"/></noscript>' . "\n";
        }

        // ─── Snapchat Pixel ─────────────────────────────────────────────
        if (!empty($config['snapchat']['pixelId'])) {
            $snap_id = esc_js($config['snapchat']['pixelId']);
            echo "<script>(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','{$snap_id}',{});snaptr('track','PAGE_VIEW');</script>\n";
        }

        // ─── Microsoft/Bing UET Tag ─────────────────────────────────────
        if (!empty($config['microsoft']['tagId'])) {
            $uet_id = esc_js($config['microsoft']['tagId']);
            echo "<script>(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:\"{$uet_id}\",enableAutoSpaTracking:true};o.q=w[u],w[u]=new UET(o),w[u].push(\"pageLoad\")},n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function(){var s=this.readyState;s&&s!==\"loaded\"&&s!==\"complete\"||(f(),n.onload=n.onreadystatechange=null)},i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})(window,document,\"script\",\"//bat.bing.com/bat.js\",\"uetq\");</script>\n";
        }

        // ─── Twitter/X Pixel ────────────────────────────────────────────
        if (!empty($config['twitter']['pixelId'])) {
            $twtr_id = esc_js($config['twitter']['pixelId']);
            echo "<script>!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','{$twtr_id}');</script>\n";
        }

        echo "<!-- OverSeek Tracking Pixels End -->\n";
    }

    /**
     * Inject Google Consent Mode v2 defaults.
     *
     * Why before all tags: Google requires consent defaults to be set before
     * any gtag/analytics scripts load. Other pixels (fbq, ttq) also benefit
     * from knowing consent state early.
     */
    private function inject_consent_mode(array $config): void
    {
        // Check for consent config in the global settings
        $consent_config = $config['_consent'] ?? array();
        $auto_accept = !empty($consent_config['autoAccept']);

        // Default: deny all (GDPR-compliant). Auto-accept: grant all (for AU, etc.)
        $default_state = $auto_accept ? 'granted' : 'denied';

        echo "<script>";
        echo "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}";
        echo "gtag('consent','default',{";
        echo "'ad_storage':'{$default_state}',";
        echo "'analytics_storage':'{$default_state}',";
        echo "'ad_user_data':'{$default_state}',";
        echo "'ad_personalization':'{$default_state}',";
        echo "'wait_for_update':500";
        echo "});";

        // If auto-accept is on, immediately grant (no banner needed)
        if ($auto_accept) {
            echo "gtag('consent','update',{'ad_storage':'granted','analytics_storage':'granted','ad_user_data':'granted','ad_personalization':'granted'});";
        }

        echo "</script>\n";
    }

    /**
     * Inject page-context-specific events into footer.
     */
    public function inject_page_events(): void
    {
        $config = $this->get_pixel_config();
        if (empty($config)) return;

        $events = array();

        // PageView — on every page
        if ($this->is_event_enabled($config, 'pageView')) {
            $events[] = $this->build_pageview_events($config);
        }

        // ViewContent — product pages
        if (is_product() && $this->is_event_enabled($config, 'viewContent')) {
            $events[] = $this->build_view_content_events($config);
        }

        // view_item_list — category/collection pages
        if ((is_product_category() || is_product_tag() || is_shop()) && $this->is_event_enabled($config, 'viewContent')) {
            $events[] = $this->build_view_item_list_events($config);
        }

        // AddToCart — fires via JS intercept on add-to-cart buttons
        if ($this->is_event_enabled($config, 'addToCart')) {
            $events[] = $this->build_add_to_cart_listener($config);
        }

        // view_cart — cart page
        if (is_cart() && $this->is_event_enabled($config, 'addToCart')) {
            $events[] = $this->build_view_cart_events($config);
        }

        // remove_from_cart — AJAX listener
        if ($this->is_event_enabled($config, 'addToCart')) {
            $events[] = $this->build_remove_from_cart_listener($config);
        }

        // InitiateCheckout — checkout page
        if (is_checkout() && !is_order_received_page() && $this->is_event_enabled($config, 'initiateCheckout')) {
            $events[] = $this->build_initiate_checkout_events($config);
            $events[] = $this->build_checkout_step_listeners($config);
        }

        // Search — search results
        if (is_search() && $this->is_event_enabled($config, 'search')) {
            $events[] = $this->build_search_events($config);
        }

        // Purchase — thank-you page (with deduplication)
        if (is_order_received_page() && $this->is_event_enabled($config, 'purchase')) {
            $events[] = $this->build_purchase_events($config);
        }

        $js = implode("\n", array_filter($events));
        if (empty($js)) return;

        echo "\n<script>/* OverSeek Pixel Events */\n{$js}\n</script>\n";
    }

    // ─── Event Builders ────────────────────────────────────────────────

    private function build_pageview_events(array $config): string
    {
        $js = '';
        if (!empty($config['meta']['pixelId'])) $js .= "fbq('track','PageView');";
        // TikTok, Pinterest, Snap, Bing, X fire page view in base code
        return $js;
    }

    private function build_view_content_events(array $config): string
    {
        global $product;
        if (!$product instanceof WC_Product) return '';

        $content_id = $this->get_content_id($product, $config);
        $value = (float) $product->get_price();
        $currency = get_woocommerce_currency();
        $name = $product->get_name();
        // Shared with server-side product_view event for cross-channel deduplication.
        $event_id = $this->get_shared_product_view_event_id((int) $product->get_id());

        $js = '';
        if (!empty($config['meta']['pixelId'])) {
            $js .= "fbq('track','ViewContent'," . wp_json_encode(['content_ids' => [$content_id], 'content_type' => 'product', 'content_name' => $name, 'value' => $value, 'currency' => $currency]) . ",{eventID:'{$event_id}'});";
        }
        if (!empty($config['tiktok']['pixelCode'])) {
            $js .= "ttq.track('ViewContent'," . wp_json_encode(['content_id' => $content_id, 'content_type' => 'product', 'content_name' => $name, 'value' => $value, 'currency' => $currency]) . ");";
        }
        if (!empty($config['pinterest']['tagId'])) {
            $js .= "pintrk('track','pagevisit'," . wp_json_encode(['product_id' => $content_id, 'product_name' => $name, 'value' => $value, 'currency' => $currency]) . ");";
        }
        if (!empty($config['snapchat']['pixelId'])) {
            $js .= "snaptr('track','VIEW_CONTENT'," . wp_json_encode(['item_ids' => [$content_id], 'price' => $value, 'currency' => $currency]) . ");";
        }
        if (!empty($config['ga4']['measurementId'])) {
            $js .= "gtag('event','view_item'," . wp_json_encode(['items' => [['item_id' => $content_id, 'item_name' => $name, 'price' => $value]], 'value' => $value, 'currency' => $currency]) . ");";
        }
        if (!empty($config['google']['conversionId']) && !empty($config['google']['conversionLabelViewItem'])) {
            $js .= "gtag('event','conversion',{send_to:'" . esc_js($config['google']['conversionId'] . '/' . $config['google']['conversionLabelViewItem']) . "',value:" . $value . ",currency:'" . esc_js($currency) . "'});";
        }
        if (!empty($config['microsoft']['tagId'])) {
            $js .= "window.uetq=window.uetq||[];window.uetq.push('event','page_view',{ecomm_prodid:'" . esc_js($content_id) . "',ecomm_pagetype:'product',revenue_value:" . $value . ",currency:'" . esc_js($currency) . "'});";
        }
        return $js;
    }

    /**
     * view_item_list — category/collection/shop pages.
     * GA4 recommended event for full ecommerce funnel.
     */
    private function build_view_item_list_events(array $config): string
    {
        if (empty($config['ga4']['measurementId'])) return '';

        $items = array();
        global $wp_query;
        $term = get_queried_object();
        $list_name = ($term instanceof WP_Term) ? $term->name : 'Shop';

        if (!empty($wp_query->posts)) {
            $count = 0;
            foreach ($wp_query->posts as $post) {
                if ($count >= 10) break;
                $product = wc_get_product($post->ID);
                if (!$product || !$product instanceof WC_Product) continue;
                $items[] = [
                    'item_id' => $this->get_content_id($product, $config),
                    'item_name' => $product->get_name(),
                    'price' => (float) $product->get_price(),
                    'index' => $count,
                ];
                $count++;
            }
        }

        if (empty($items)) return '';

        return "gtag('event','view_item_list'," . wp_json_encode([
            'item_list_name' => $list_name,
            'items' => $items,
        ]) . ");";
    }

    /**
     * AJAX add-to-cart listener — intercepts WC single and archive ATC buttons.
     */
    private function build_add_to_cart_listener(array $config): string
    {
        $google_atc_label = $config['google']['conversionLabelAddToCart'] ?? '';
        $google_conv_id = $config['google']['conversionId'] ?? '';
        $platforms = wp_json_encode([
            'meta' => !empty($config['meta']['pixelId']),
            'tiktok' => !empty($config['tiktok']['pixelCode']),
            'pinterest' => !empty($config['pinterest']['tagId']),
            'snapchat' => !empty($config['snapchat']['pixelId']),
            'ga4' => !empty($config['ga4']['measurementId']),
            'googleAds' => !empty($config['google']['conversionId']),
            'googleAdsAtc' => (!empty($google_conv_id) && !empty($google_atc_label)) ? esc_js($google_conv_id . '/' . $google_atc_label) : false,
            'bing' => !empty($config['microsoft']['tagId']),
            'twitter' => !empty($config['twitter']['pixelId']),
        ]);

        return <<<JS
(function(){
    var p={$platforms};
    function makeEid(){
        return (crypto.randomUUID?crypto.randomUUID():'os_'+Date.now().toString(36)+Math.random().toString(36).slice(2,10));
    }
    function ensureButtonEid(btn){
        var b=jQuery(btn);
        var eid=b.attr('data-overseek-event-id')||b.attr('data-os-eid')||'';
        if(!eid){
            eid=makeEid();
            b.attr('data-overseek-event-id',eid);
            b.attr('data-os-eid',eid);
        }
        var href=b.attr('href')||'';
        if(href && href.indexOf('overseek_event_id=')===-1){
            var sep=href.indexOf('?')===-1?'?':'&';
            b.attr('href',href+sep+'overseek_event_id='+encodeURIComponent(eid));
        }
        return eid;
    }
    function fireATC(productName,productId,value,currency,eid){
        eid=eid||makeEid();
        if(p.meta) fbq('track','AddToCart',{content_ids:[productId],content_type:'product',content_name:productName,value:value,currency:currency},{eventID:eid});
        if(p.tiktok) ttq.track('AddToCart',{content_id:productId,content_type:'product',value:value,currency:currency});
        if(p.pinterest) pintrk('track','addtocart',{product_id:productId,value:value,currency:currency});
        if(p.snapchat) snaptr('track','ADD_CART',{item_ids:[productId],price:value,currency:currency});
        if(p.ga4) gtag('event','add_to_cart',{items:[{item_id:productId,item_name:productName,price:value}],value:value,currency:currency});
        if(p.googleAdsAtc) gtag('event','conversion',{send_to:p.googleAdsAtc,value:value,currency:currency});
        if(p.bing){window.uetq=window.uetq||[];window.uetq.push('event','add_to_cart',{ecomm_prodid:productId,revenue_value:value,currency:currency});}
        if(p.twitter&&window.twq) twq('event','tw-atc-event',{value:value,currency:currency,num_items:1});
    }
    jQuery(document).on('click','.add_to_cart_button, .ajax_add_to_cart',function(){
        ensureButtonEid(this);
    });
    jQuery(document.body).on('added_to_cart',function(e,fragments,cart_hash,btn){
        var eid=btn?ensureButtonEid(btn):makeEid();
        var name=btn&&btn.data('product_name')||'';
        var id=btn&&btn.data('product_id')||'';
        var price=btn&&btn.data('product_price')||0;
        fireATC(name,String(id),parseFloat(price)||0,'{$this->get_currency()}',eid);
    });
    jQuery('form.cart').on('submit',function(){
        var form=jQuery(this);
        var eidInput=form.find('input[name="overseek_event_id"]');
        var eid=eidInput.val()||makeEid();
        if(!eidInput.length){eidInput=jQuery('<input/>',{type:'hidden',name:'overseek_event_id'});form.append(eidInput);}
        eidInput.val(eid);
        var name=form.closest('.product').find('.product_title').text()||'';
        var id=form.find('input[name=product_id],button[name=add-to-cart]').val()||'';
        var price=form.closest('.product').find('.price ins .amount, .price > .amount').first().text().replace(/[^0-9.]/g,'')||0;
        fireATC(name.trim(),String(id),parseFloat(price)||0,'{$this->get_currency()}',String(eid));
    });
})();
JS;
    }

    /**
     * view_cart — GA4 recommended event.
     */
    private function build_view_cart_events(array $config): string
    {
        if (empty($config['ga4']['measurementId'])) return '';

        $cart = WC()->cart;
        if (!$cart) return '';

        $items = array();
        foreach ($cart->get_cart() as $item) {
            $product = $item['data'] ?? null;
            if (!$product instanceof WC_Product) continue;
            $items[] = [
                'item_id' => $this->get_content_id($product, $config),
                'item_name' => $product->get_name(),
                'price' => (float) $product->get_price(),
                'quantity' => (int) $item['quantity'],
            ];
        }

        return "gtag('event','view_cart'," . wp_json_encode([
            'value' => (float) $cart->get_total('edit'),
            'currency' => get_woocommerce_currency(),
            'items' => $items,
        ]) . ");";
    }

    /**
     * remove_from_cart — GA4 recommended event via AJAX listener.
     */
    private function build_remove_from_cart_listener(array $config): string
    {
        if (empty($config['ga4']['measurementId'])) return '';

        return <<<JS
jQuery(document.body).on('removed_from_cart',function(e,fragments,hash,btn){
    var name=btn&&btn.data('product_name')||'';
    var id=btn&&btn.data('product_id')||'';
    gtag('event','remove_from_cart',{items:[{item_id:String(id),item_name:name}]});
});
JS;
    }

    private function build_initiate_checkout_events(array $config): string
    {
        $cart = WC()->cart;
        if (!$cart) return '';

        $value = (float) $cart->get_total('edit');
        $currency = get_woocommerce_currency();
        $num_items = $cart->get_cart_contents_count();
        // Persisted into checkout form so server-side checkout_start can reuse it.
        $event_id = wp_generate_uuid4();

        $js = '';
        if (!empty($config['meta']['pixelId'])) {
            $js .= "fbq('track','InitiateCheckout'," . wp_json_encode(['value' => $value, 'currency' => $currency, 'num_items' => $num_items]) . ",{eventID:'{$event_id}'});";
        }
        if (!empty($config['tiktok']['pixelCode'])) {
            $tt_content_ids = [];
            foreach ($cart->get_cart() as $item) {
                $product = $item['data'] ?? null;
                if ($product) $tt_content_ids[] = (string) $this->get_content_id($product, $config);
            }
            $js .= "ttq.track('InitiateCheckout'," . wp_json_encode(['content_id' => implode(',', $tt_content_ids), 'content_type' => 'product', 'value' => $value, 'currency' => $currency]) . ");";
        }
        if (!empty($config['pinterest']['tagId'])) {
            $js .= "pintrk('track','checkout'," . wp_json_encode(['value' => $value, 'currency' => $currency, 'order_quantity' => $num_items]) . ");";
        }
        if (!empty($config['snapchat']['pixelId'])) {
            $js .= "snaptr('track','START_CHECKOUT'," . wp_json_encode(['price' => $value, 'currency' => $currency, 'number_items' => $num_items]) . ");";
        }
        if (!empty($config['ga4']['measurementId'])) {
            $js .= "gtag('event','begin_checkout'," . wp_json_encode(['value' => $value, 'currency' => $currency]) . ");";
        }
        // Note: begin_checkout conversion is handled server-side via CAPI to avoid
        // blocking Stripe.js on the checkout page. Do NOT add a client-side gtag
        // conversion call here.
        if (!empty($config['microsoft']['tagId'])) {
            $js .= "window.uetq=window.uetq||[];window.uetq.push('event','begin_checkout',{revenue_value:" . $value . ",currency:'" . esc_js($currency) . "'});";
        }
        // Ensure form submission carries the same event ID for server-side dedup.
        $js .= "(function(){function setOverseekEventId(){var f=jQuery('form.checkout').first();if(!f.length)return;var i=f.find('input[name=\"overseek_event_id\"]');if(!i.length){i=jQuery('<input/>',{type:'hidden',name:'overseek_event_id'});f.append(i);}i.val('{$event_id}');}setOverseekEventId();jQuery(document.body).on('updated_checkout',setOverseekEventId);})();";
        return $js;
    }

    /**
     * add_shipping_info + add_payment_info — GA4 checkout step events.
     * Fires via JS listeners on WC checkout form interactions.
     */
    private function build_checkout_step_listeners(array $config): string
    {
        if (empty($config['ga4']['measurementId'])) return '';

        $value = (float) WC()->cart->get_total('edit');
        $currency = esc_js(get_woocommerce_currency());

        return <<<JS
(function(){
    var shippingFired=false,paymentFired=false;
    jQuery(document.body).on('updated_checkout',function(){
        if(!shippingFired&&jQuery('[name="shipping_method[0]"]:checked').length){
            shippingFired=true;
            var method=jQuery('[name="shipping_method[0]"]:checked').val()||'';
            gtag('event','add_shipping_info',{currency:'{$currency}',value:{$value},shipping_tier:method});
        }
    });
    jQuery('form.checkout').on('change','[name=payment_method]',function(){
        if(!paymentFired){
            paymentFired=true;
            gtag('event','add_payment_info',{currency:'{$currency}',value:{$value},payment_type:jQuery(this).val()||''});
        }
    });
})();
JS;
    }

    private function build_search_events(array $config): string
    {
        $query = get_search_query();
        $js = '';
        if (!empty($config['meta']['pixelId'])) {
            $js .= "fbq('track','Search'," . wp_json_encode(['search_string' => $query]) . ");";
        }
        if (!empty($config['tiktok']['pixelCode'])) {
            $js .= "ttq.track('Search'," . wp_json_encode(['query' => $query]) . ");";
        }
        if (!empty($config['snapchat']['pixelId'])) {
            $js .= "snaptr('track','SEARCH'," . wp_json_encode(['search_string' => $query]) . ");";
        }
        if (!empty($config['ga4']['measurementId'])) {
            $js .= "gtag('event','search'," . wp_json_encode(['search_term' => $query]) . ");";
        }
        return $js;
    }

    /**
     * Purchase event with deduplication via order meta.
     */
    private function build_purchase_events(array $config): string
    {
        global $wp;
        $order_id = isset($wp->query_vars['order-received']) ? absint($wp->query_vars['order-received']) : 0;
        if (!$order_id) return '';

        $order = wc_get_order($order_id);
        if (!$order) return '';

        // Deduplication: only fire once per order
        if ($order->get_meta('_overseek_pixel_tracked')) return '';
        $order->update_meta_data('_overseek_pixel_tracked', '1');
        $order->save();

        $total = (float) $order->get_total();
        $currency = $order->get_currency();
        $event_id = $order->get_meta('_overseek_event_id');
        if (empty($event_id)) {
            $event_id = wp_generate_uuid4();
            $order->update_meta_data('_overseek_event_id', $event_id);
            $order->save();
        }

        if (!empty($config['meta']['excludeShipping'])) $total -= (float) $order->get_shipping_total();
        if (!empty($config['meta']['excludeTax'])) $total -= (float) $order->get_total_tax();
        $total = max(0, round($total, 2));

        $items = array();
        foreach ($order->get_items() as $item) {
            $product = $item->get_product();
            if (!$product) continue;
            $items[] = array(
                'id' => $this->get_content_id($product, $config),
                'name' => $item->get_name(),
                'quantity' => $item->get_quantity(),
                'price' => (float) $order->get_item_total($item),
            );
        }

        $js = '';
        // Meta
        if (!empty($config['meta']['pixelId'])) {
            $content_ids = array_column($items, 'id');
            $js .= "fbq('track','Purchase'," . wp_json_encode(['value' => $total, 'currency' => $currency, 'content_ids' => $content_ids, 'content_type' => 'product', 'num_items' => count($items)]) . ",{eventID:'{$event_id}'});";
        }
        // TikTok
        if (!empty($config['tiktok']['pixelCode'])) {
            $tt_content_ids = array_column($items, 'id');
            $js .= "ttq.track('CompletePayment'," . wp_json_encode(['content_id' => implode(',', $tt_content_ids), 'content_type' => 'product', 'value' => $total, 'currency' => $currency]) . ");";
        }
        // Pinterest
        if (!empty($config['pinterest']['tagId'])) {
            $product_ids = array_column($items, 'id');
            $js .= "pintrk('track','checkout'," . wp_json_encode(['value' => $total, 'currency' => $currency, 'order_quantity' => count($items), 'product_ids' => $product_ids]) . ");";
        }
        // Snapchat
        if (!empty($config['snapchat']['pixelId'])) {
            $js .= "snaptr('track','PURCHASE'," . wp_json_encode(['price' => $total, 'currency' => $currency, 'transaction_id' => (string) $order_id, 'number_items' => count($items)]) . ");";
        }
        // GA4
        if (!empty($config['ga4']['measurementId'])) {
            $ga4_items = array_map(function ($item) {
                return ['item_id' => $item['id'], 'item_name' => $item['name'], 'price' => $item['price'], 'quantity' => $item['quantity']];
            }, $items);
            $js .= "gtag('event','purchase'," . wp_json_encode(['transaction_id' => (string) $order_id, 'value' => $total, 'currency' => $currency, 'tax' => (float) $order->get_total_tax(), 'shipping' => (float) $order->get_shipping_total(), 'items' => $ga4_items]) . ");";
        }
        // Google Ads
        if (!empty($config['google']['conversionId']) && !empty($config['google']['conversionLabel'])) {
            $js .= "gtag('event','conversion',{send_to:'" . esc_js($config['google']['conversionId'] . '/' . $config['google']['conversionLabel']) . "',value:" . $total . ",currency:'" . esc_js($currency) . "',transaction_id:'" . esc_js((string) $order_id) . "'});";
        }
        // Microsoft/Bing
        if (!empty($config['microsoft']['tagId'])) {
            $js .= "window.uetq=window.uetq||[];window.uetq.push('event','purchase',{revenue_value:" . $total . ",currency:'" . esc_js($currency) . "',ecomm_prodid:" . wp_json_encode(array_column($items, 'id')) . "});";
        }
        // Twitter/X
        if (!empty($config['twitter']['pixelId'])) {
            $js .= "twq('event','tw-purchase-event',{value:" . $total . ",currency:'" . esc_js($currency) . "',num_items:" . count($items) . ",order_id:'" . esc_js((string) $order_id) . "'});";
        }

        return $js;
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    private function is_event_enabled(array $config, string $event_key): bool
    {
        foreach ($config as $key => $platform_config) {
            if ($key === '_consent') continue;
            if (!is_array($platform_config)) continue;
            $events = $platform_config['events'] ?? array();
            if (!empty($events[$event_key])) return true;
        }
        return true;
    }

    private function get_content_id(WC_Product $product, array $config): string
    {
        $format = $config['meta']['contentIdFormat'] ?? 'sku';
        $prefix = $config['meta']['contentIdPrefix'] ?? '';
        $suffix = $config['meta']['contentIdSuffix'] ?? '';
        $id = ($format === 'id') ? (string) $product->get_id() : ($product->get_sku() ?: (string) $product->get_id());
        return $prefix . $id . $suffix;
    }

    /**
     * Build advanced matching parameters for Meta Pixel init.
     */
    private function get_advanced_matching_params(array $meta_config): array
    {
        if (empty($meta_config['advancedMatching'])) return array();

        $params = array();
        $user = wp_get_current_user();
        if ($user->ID > 0) {
            if ($user->user_email) $params['em'] = strtolower(trim($user->user_email));
            if ($user->first_name) $params['fn'] = strtolower(trim($user->first_name));
            if ($user->last_name) $params['ln'] = strtolower(trim($user->last_name));
        }

        $wc = function_exists('WC') ? WC() : null;
        $customer = $wc ? ($wc->customer ?? null) : null;
        if ($customer) {
            $phone = $customer->get_billing_phone();
            if ($phone) $params['ph'] = preg_replace('/[^0-9]/', '', $phone);
            $zip = $customer->get_billing_postcode();
            if ($zip) $params['zp'] = strtolower(trim($zip));
            $city = $customer->get_billing_city();
            if ($city) $params['ct'] = strtolower(trim($city));
            $state = $customer->get_billing_state();
            if ($state) $params['st'] = strtolower(trim($state));
            $country = $customer->get_billing_country();
            if ($country) $params['country'] = strtolower(trim($country));
        }

        return $params;
    }

    /**
     * Build TikTok identify() parameters for Advanced Matching.
     */
    private function get_tiktok_identify_params(): array
    {
        $params = array();
        $user = wp_get_current_user();
        if ($user->ID > 0 && $user->user_email) {
            $params['email'] = hash('sha256', strtolower(trim($user->user_email)));
        }

        $wc = function_exists('WC') ? WC() : null;
        $customer = $wc ? ($wc->customer ?? null) : null;
        if ($customer) {
            $phone = $customer->get_billing_phone();
            if ($phone) {
                $params['phone_number'] = hash('sha256', preg_replace('/[^0-9+]/', '', $phone));
            }
        }

        return $params;
    }

    /**
     * Get external ID for Meta advanced matching.
     * Uses WC customer ID or visitor cookie.
     */
    private function get_external_id(): string
    {
        $user = wp_get_current_user();
        if ($user->ID > 0) return 'wc_' . $user->ID;

        // Fall back to OverSeek visitor ID cookie
        return isset($_COOKIE['_os_vid']) ? sanitize_text_field($_COOKIE['_os_vid']) : '';
    }

    /**
     * Deterministic event ID for product_view so browser + server can deduplicate.
     */
    private function get_shared_product_view_event_id(int $product_id): string
    {
        $visitor = isset($_COOKIE['_os_vid']) ? sanitize_text_field($_COOKIE['_os_vid']) : '';
        $material = implode('|', ['overseek', 'product_view', (string) $product_id, $visitor]);
        return 'os_pv_' . substr(hash('sha256', $material), 0, 32);
    }

    /**
     * Fetch pixel config from OverSeek API with stale-while-revalidate caching.
     *
     * Uses two transients:
     *   - Primary (30 min TTL): when fresh, returned immediately.
     *   - Stale fallback (24 h TTL): returned instantly while a background
     *     refresh is scheduled, so checkout/page rendering is NEVER blocked
     *     by an external HTTP call.
     */
    private function get_pixel_config(): array
    {
        if ($this->config !== null) return $this->config;

        $hash          = md5($this->account_id);
        $transient_key = 'overseek_pixels_' . $hash;
        $stale_key     = 'overseek_pixels_stale_' . $hash;

        // 1. Fresh cache hit — fast path
        $cached = get_transient($transient_key);
        if ($cached !== false && is_array($cached)) {
            $this->config = $cached;
            return $this->config;
        }

        // 2. Stale cache hit — serve immediately, schedule background refresh
        $stale = get_transient($stale_key);
        if ($stale !== false && is_array($stale)) {
            $this->config = $stale;
            $this->schedule_background_refresh();
            return $this->config;
        }

        // 3. Cold start (no cache at all) — must fetch, but with generous timeout
        $data = $this->fetch_pixel_config_from_api();
        $this->config = $data;
        return $this->config;
    }

    /**
     * Perform the actual API call and update both cache layers.
     */
    private function fetch_pixel_config_from_api(): array
    {
        $response = wp_remote_get(
            $this->api_url . '/api/capi/pixels/' . $this->account_id,
            array(
                'timeout' => 5,
                'headers' => array('Accept' => 'application/json'),
            )
        );

        if (is_wp_error($response)) {
            return array();
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if (!is_array($data)) {
            return array();
        }

        $hash = md5($this->account_id);
        set_transient('overseek_pixels_' . $hash, $data, 30 * MINUTE_IN_SECONDS);
        set_transient('overseek_pixels_stale_' . $hash, $data, DAY_IN_SECONDS);
        return $data;
    }

    /**
     * Schedule a non-blocking background refresh via WP Cron.
     * Ensures at most one refresh per 5 minutes.
     */
    private function schedule_background_refresh(): void
    {
        $hook = 'overseek_refresh_pixel_config';
        if (!wp_next_scheduled($hook, array($this->account_id))) {
            wp_schedule_single_event(time(), $hook, array($this->account_id));
        }
    }

    private function get_currency(): string
    {
        return function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : 'USD';
    }
}
