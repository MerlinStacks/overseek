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

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class OverSeek_Pixels.
 */
class OverSeek_Pixels {

	/**
	 * API base URL for OverSeek.
	 *
	 * @var string
	 */
	private $api_url;

	/**
	 * OverSeek account ID.
	 *
	 * @var string
	 */
	private $account_id;

	/**
	 * Cached pixel config.
	 *
	 * @var array<string, mixed>|null
	 */
	private $config = null;

	/**
	 * Initialize pixel injection hooks.
	 */
	public function __construct() {
		$this->api_url    = untrailingslashit( get_option( 'overseek_api_url', '' ) );
		$this->account_id = get_option( 'overseek_account_id', '' );

		// Always register the cron callback, even when frontend hooks are skipped.
		add_action( 'overseek_refresh_pixel_config', array( $this, 'handle_background_refresh' ) );

		if ( empty( $this->account_id ) || empty( $this->api_url ) ) {
			return;
		}

		add_filter( 'woocommerce_loop_add_to_cart_args', array( $this, 'add_loop_content_id' ), 10, 2 );
		add_filter( 'woocommerce_available_variation', array( $this, 'add_variation_content_id' ), 10, 3 );
		add_action( 'woocommerce_before_add_to_cart_button', array( $this, 'render_add_to_cart_content_id' ) );

		if ( is_admin() || defined( 'REST_REQUEST' ) || wp_doing_ajax() ) {
			return;
		}

		add_action( 'wp_head', array( $this, 'inject_base_codes' ), 1 );
		add_action( 'wp_footer', array( $this, 'inject_page_events' ), 50 );
	}

	/**
	 * Add the catalog-matching content ID to product-loop add-to-cart buttons.
	 *
	 * @param array<string, mixed> $args    Add-to-cart link arguments.
	 * @param WC_Product          $product WooCommerce product.
	 * @return array<string, mixed>
	 */
	public function add_loop_content_id( array $args, WC_Product $product ): array {
		$config = $this->get_pixel_config();
		if ( empty( $config ) ) {
			return $args;
		}

		if ( ! isset( $args['attributes'] ) || ! is_array( $args['attributes'] ) ) {
			$args['attributes'] = array();
		}
		$args['attributes']['data-overseek-content-id'] = OverSeek_Pixel_Matching_Utils::get_content_id( $product, $config );

		return $args;
	}

	/**
	 * Expose the catalog-matching ID for each selectable variation.
	 *
	 * @param array<string, mixed>  $data      Variation data sent to WooCommerce JavaScript.
	 * @param WC_Product_Variable  $product   Parent product.
	 * @param WC_Product_Variation $variation Product variation.
	 * @return array<string, mixed>
	 */
	public function add_variation_content_id( array $data, WC_Product_Variable $product, WC_Product_Variation $variation ): array {
		$config = $this->get_pixel_config();
		if ( ! empty( $config ) ) {
			$data['overseek_content_id'] = OverSeek_Pixel_Matching_Utils::get_content_id( $variation, $config );
		}

		return $data;
	}

	/**
	 * Render the canonical product ID used by single-product add-to-cart forms.
	 */
	public function render_add_to_cart_content_id(): void {
		global $product;

		$config = $this->get_pixel_config();
		if ( ! $product instanceof WC_Product || empty( $config ) ) {
			return;
		}

		$content_id = OverSeek_Pixel_Matching_Utils::get_content_id( $product, $config );
		printf(
			'<input type="hidden" name="overseek_content_id" value="%1$s" data-parent-content-id="%1$s" />',
			esc_attr( $content_id )
		);
	}

	/**
	 * WP-Cron callback: refresh pixel config in the background (non-blocking).
	 *
	 * @param string $account_id Optional account ID override.
	 */
	public function handle_background_refresh( string $account_id = '' ): void {
		if ( empty( $account_id ) ) {
			$account_id = $this->account_id;
		}
		if ( empty( $account_id ) || empty( $this->api_url ) ) {
			return;
		}
		OverSeek_Pixel_Config_Provider::refresh_config( $this->api_url, $account_id );
	}

	/**
	 * Inject pixel base codes into <head>.
	 * Includes Google Consent Mode v2 defaults BEFORE any Google tags.
	 */
	public function inject_base_codes(): void {
		$config = $this->get_pixel_config();
		if ( empty( $config ) ) {
			return;
		}

		// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
		echo "\n<!-- OverSeek Tracking Pixels v" . esc_html( OVERSEEK_WC_VERSION ) . " -->\n";

		// ─── Google Consent Mode v2 ──────────────────────────────────────.
		// Must come BEFORE any gtag/fbq/ttq scripts.
		$this->inject_consent_mode( $config );
		$this->inject_pixel_loader();

		// ─── Meta Pixel ─────────────────────────────────────────────────.
		if ( ! empty( $config['meta']['pixelId'] ) ) {
			$pixel_id    = esc_js( $config['meta']['pixelId'] );
			$init_params = OverSeek_Pixel_Matching_Utils::get_advanced_matching_params( $config['meta'] );

			// Add external_id for improved Event Match Quality.
			$external_id = OverSeek_Pixel_Matching_Utils::get_external_id();
			if ( $external_id && ! empty( $config['meta']['advancedMatching'] ) ) {
				$init_params['external_id'] = hash( 'sha256', strtolower( trim( $external_id ) ) );
			}

			echo "<script>!function(f){if(f.fbq)return;var n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];f.overseekLoadTrackingScript&&f.overseekLoadTrackingScript('https://connect.facebook.net/en_US/fbevents.js')}(window);";
			if ( ! empty( $init_params ) ) {
				echo "fbq('init','{$pixel_id}'," . wp_json_encode( $init_params ) . ');';
			} else {
				echo "fbq('init','{$pixel_id}');";
			}
			echo "</script>\n";
			echo '<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=' . esc_attr( $pixel_id ) . '&ev=PageView&noscript=1"/></noscript>' . "\n";
		}

		// ─── TikTok Pixel + Advanced Matching ───────────────────────────.
		if ( ! empty( $config['tiktok']['pixelCode'] ) ) {
			$pixel_code = esc_js( $config['tiktok']['pixelCode'] );
			echo "<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie','holdConsent','revokeConsent','grantConsent'],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r='https://analytics.tiktok.com/i18n/pixel/events.js',o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e+\"_\"+o]=1;w.overseekLoadTrackingScript&&w.overseekLoadTrackingScript(r+'?sdkid='+e+'&lib='+t)};ttq.load('{$pixel_code}');ttq.page();";

			// TikTok Advanced Matching — send hashed PII for better match rates.
			if ( ! empty( $config['tiktok']['advancedMatching'] ) ) {
				$tt_identify = OverSeek_Pixel_Matching_Utils::get_tiktok_identify_params();
				if ( ! empty( $tt_identify ) ) {
					echo 'ttq.identify(' . wp_json_encode( $tt_identify ) . ');';
				}
			}
			echo "}(window,document,'ttq');</script>\n";
		}

		// ─── Google Analytics 4 + Google Ads (shared gtag.js) ───────────.
		$ga4_id       = $config['ga4']['measurementId'] ?? '';
		$gads_id      = $config['google']['conversionId'] ?? '';
		$gtag_primary = ( '' !== $ga4_id ) ? $ga4_id : $gads_id;
		if ( ! empty( $gtag_primary ) ) {
			echo '<script async fetchpriority="low" src="https://www.googletagmanager.com/gtag/js?id=' . esc_attr( $gtag_primary ) . '"></script>' . "\n";
			// gtag() and dataLayer already defined by consent mode above — only add js init + config calls.
			echo "<script>gtag('js',new Date());";
			$google_user_data = ! empty( $gads_id ) ? OverSeek_Pixel_Matching_Utils::get_google_user_data_params() : array();
			if ( ! empty( $google_user_data ) ) {
				echo "gtag('set','user_data'," . wp_json_encode( $google_user_data ) . ');';
			}
			if ( ! empty( $ga4_id ) ) {
				echo "gtag('config','" . esc_js( $ga4_id ) . "');";
			}
			if ( ! empty( $gads_id ) ) {
				echo "gtag('config','" . esc_js( $gads_id ) . "',{'allow_enhanced_conversions':true});";
			}
			echo "</script>\n";
		}

		// ─── Pinterest Tag ──────────────────────────────────────────────.
		if ( ! empty( $config['pinterest']['tagId'] ) ) {
			$tag_id = esc_js( $config['pinterest']['tagId'] );
			echo "<script>!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version='3.0';var t=document.createElement('script');t.async=!0,t.src=e;var r=document.getElementsByTagName('script')[0];r.parentNode.insertBefore(t,r)}}('https://s.pinimg.com/ct/core.js');pintrk('load','{$tag_id}');pintrk('page');</script>\n";
			echo '<noscript><img height="1" width="1" style="display:none" src="https://ct.pinterest.com/v3/?event=init&tid=' . esc_attr( $tag_id ) . '&noscript=1"/></noscript>' . "\n";
		}

		// ─── Snapchat Pixel ─────────────────────────────────────────────.
		if ( ! empty( $config['snapchat']['pixelId'] ) ) {
			$snap_id = esc_js( $config['snapchat']['pixelId'] );
			echo "<script>(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','{$snap_id}',{});snaptr('track','PAGE_VIEW');</script>\n";
		}

		// ─── Microsoft/Bing UET Tag ─────────────────────────────────────.
		if ( ! empty( $config['microsoft']['tagId'] ) ) {
			$uet_id = esc_js( $config['microsoft']['tagId'] );
			echo "<script>(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:\"{$uet_id}\",enableAutoSpaTracking:true};o.q=w[u],w[u]=new UET(o),w[u].push(\"pageLoad\")},n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function(){var s=this.readyState;s&&s!==\"loaded\"&&s!==\"complete\"||(f(),n.onload=n.onreadystatechange=null)},i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})(window,document,\"script\",\"//bat.bing.com/bat.js\",\"uetq\");</script>\n";
		}

		// ─── Twitter/X Pixel ────────────────────────────────────────────.
		if ( ! empty( $config['twitter']['pixelId'] ) ) {
			$twtr_id = esc_js( $config['twitter']['pixelId'] );
			echo "<script>!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','{$twtr_id}');</script>\n";
		}

		echo "<!-- OverSeek Tracking Pixels End -->\n";
		// phpcs:enable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
	}

	/**
	 * Inject a tiny deferred script loader for third-party pixels.
	 * Pixel command queues are created immediately, but heavy vendor libraries
	 * load after page load/idle to reduce render and main-thread contention.
	 */
	private function inject_pixel_loader(): void {
		// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
		echo '<script>';
		echo 'window.overseekLoadTrackingScript=window.overseekLoadTrackingScript||function(src,onload){var w=window,d=document,loaded=w.__overseekLoadedTrackingScripts=w.__overseekLoadedTrackingScripts||{};if(loaded[src]){if(onload){onload();}return;}loaded[src]=1;var load=function(){var s=d.createElement("script");s.async=true;s.src=src;if(onload){s.onload=onload;}var first=d.getElementsByTagName("script")[0];first.parentNode.insertBefore(s,first);};var schedule=function(){if("requestIdleCallback" in w){w.requestIdleCallback(load,{timeout:2000});}else{setTimeout(load,1);}};if(d.readyState==="complete"){schedule();}else{w.addEventListener("load",schedule,{once:true});}};';
		echo "</script>\n";
		// phpcs:enable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
	}

	/**
	 * Inject Google Consent Mode v2 defaults.
	 *
	 * Why before all tags: Google requires consent defaults to be set before
	 * any gtag/analytics scripts load. Other pixels (fbq, ttq) also benefit
	 * from knowing consent state early.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 */
	private function inject_consent_mode( array $config ): void {
		// Check for consent config in the global settings.
		$consent_config = $config['_consent'] ?? array();
		$auto_accept    = ! empty( $consent_config['autoAccept'] );

		// Default: deny all (GDPR-compliant). Auto-accept: grant all (for AU, etc.).
		$default_state = $auto_accept ? 'granted' : 'denied';

		// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
		echo '<script>';
		echo 'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}';
		echo "gtag('consent','default',{";
		echo "'ad_storage':'{$default_state}',";
		echo "'analytics_storage':'{$default_state}',";
		echo "'ad_user_data':'{$default_state}',";
		echo "'ad_personalization':'{$default_state}',";
		echo "'wait_for_update':500";
		echo '});';

		// If auto-accept is on, immediately grant (no banner needed).
		if ( $auto_accept ) {
			echo "gtag('consent','update',{'ad_storage':'granted','analytics_storage':'granted','ad_user_data':'granted','ad_personalization':'granted'});";
		}

		echo "</script>\n";
		// phpcs:enable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
	}

	/**
	 * Inject page-context-specific events into footer.
	 */
	public function inject_page_events(): void {
		$config = $this->get_pixel_config();
		if ( empty( $config ) ) {
			return;
		}

		$events = array();

		// PageView — on every page.
		if ( $this->is_event_enabled( $config, 'pageView' ) ) {
			$events[] = $this->build_pageview_events( $config );
		}

		// ViewContent — product pages.
		if ( is_product() && $this->is_event_enabled( $config, 'viewContent' ) ) {
			$events[] = OverSeek_Pixel_Ecommerce_Events::build_view_content_events( $config );
		}

		// view_item_list — category/collection pages.
		if ( ( is_product_category() || is_product_tag() || is_shop() ) && $this->is_event_enabled( $config, 'viewContent' ) ) {
			$events[] = OverSeek_Pixel_Ecommerce_Events::build_view_item_list_events( $config );
		}

		// AddToCart — fires via JS intercept on add-to-cart buttons.
		if ( $this->is_event_enabled( $config, 'addToCart' ) ) {
			$events[] = $this->build_add_to_cart_listener( $config );
		}

		// view_cart — cart page.
		if ( is_cart() && $this->is_event_enabled( $config, 'addToCart' ) ) {
			$events[] = OverSeek_Pixel_Ecommerce_Events::build_view_cart_events( $config );
		}

		// remove_from_cart — AJAX listener.
		if ( $this->is_event_enabled( $config, 'addToCart' ) ) {
			$events[] = $this->build_remove_from_cart_listener( $config );
		}

		// InitiateCheckout — checkout page.
		if ( is_checkout() && ! is_order_received_page() && $this->is_event_enabled( $config, 'initiateCheckout' ) ) {
			$events[] = OverSeek_Pixel_Ecommerce_Events::build_initiate_checkout_events( $config );
			$events[] = $this->build_checkout_step_listeners( $config );
		}

		// Search — search results.
		if ( is_search() && $this->is_event_enabled( $config, 'search' ) ) {
			$events[] = $this->build_search_events( $config );
		}

		// Purchase — thank-you page (with deduplication).
		if ( is_order_received_page() && $this->is_event_enabled( $config, 'purchase' ) ) {
			$events[] = OverSeek_Pixel_Ecommerce_Events::build_purchase_events( $config );
		}

		$js = implode( "\n", array_filter( $events ) );
		if ( empty( $js ) ) {
			return;
		}

		// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
		echo "\n<script>/* OverSeek Pixel Events */\n{$js}\n</script>\n";
		// phpcs:enable WordPress.Security.EscapeOutput.OutputNotEscaped, WordPress.WP.EnqueuedResources.NonEnqueuedScript
	}

	// ─── Event Builders ────────────────────────────────────────────────

	/**
	 * Build PageView pixel events.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	private function build_pageview_events( array $config ): string {
		$js = '';
		if ( ! empty( $config['meta']['pixelId'] ) ) {
			$js .= "fbq('track','PageView');";
		}
		// TikTok, Pinterest, Snap, Bing, X fire page view in base code.
		return $js;
	}


	/**
	 * AJAX add-to-cart listener — intercepts WC single and archive ATC buttons.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	private function build_add_to_cart_listener( array $config ): string {
		$google_atc_label = $config['google']['conversionLabelAddToCart'] ?? '';
		$google_conv_id   = $config['google']['conversionId'] ?? '';
		$platforms        = wp_json_encode(
			array(
				'meta'         => ! empty( $config['meta']['pixelId'] ),
				'tiktok'       => ! empty( $config['tiktok']['pixelCode'] ),
				'pinterest'    => ! empty( $config['pinterest']['tagId'] ),
				'snapchat'     => ! empty( $config['snapchat']['pixelId'] ),
				'ga4'          => ! empty( $config['ga4']['measurementId'] ),
				'googleAds'    => ! empty( $config['google']['conversionId'] ),
				'googleAdsAtc' => ( ! empty( $google_conv_id ) && ! empty( $google_atc_label ) ) ? esc_js( $google_conv_id . '/' . $google_atc_label ) : false,
				'bing'         => ! empty( $config['microsoft']['tagId'] ),
				'twitter'      => ! empty( $config['twitter']['pixelId'] ),
			)
		);

		return <<<JS
(function(){
    var p={$platforms};
    if(!window.jQuery){return;}
    var jQuery=window.jQuery;
    function makeEid(){
        return (window.crypto&&typeof window.crypto.randomUUID==='function'?window.crypto.randomUUID():'os_'+Date.now().toString(36)+Math.random().toString(36).slice(2,10));
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
        if(p.meta&&window.fbq) fbq('track','AddToCart',{content_ids:[productId],content_type:'product',content_name:productName,value:value,currency:currency},{eventID:eid});
        if(p.tiktok&&window.ttq) ttq.track('AddToCart',{content_id:productId,content_type:'product',value:value,currency:currency},{event_id:eid});
        if(p.pinterest&&window.pintrk) pintrk('track','addtocart',{product_id:productId,value:value,currency:currency,event_id:eid});
        if(p.snapchat&&window.snaptr) snaptr('track','ADD_CART',{item_ids:[productId],price:value,currency:currency,event_tag:eid});
        if(p.ga4&&window.gtag) gtag('event','add_to_cart',{items:[{item_id:productId,item_name:productName,price:value}],value:value,currency:currency});
        if(p.googleAdsAtc&&window.gtag) gtag('event','conversion',{send_to:p.googleAdsAtc,value:value,currency:currency,items:[{id:String(productId),quantity:1,price:value}]});
        if(p.bing){window.uetq=window.uetq||[];window.uetq.push('event','add_to_cart',{ecomm_prodid:productId,revenue_value:value,currency:currency,event_id:eid});}
        if(p.twitter&&window.twq) twq('event','tw-atc-event',{value:value,currency:currency,num_items:1,event_id:eid});
    }
    jQuery(document).on('click','.add_to_cart_button, .ajax_add_to_cart',function(){
        ensureButtonEid(this);
    });
    jQuery(document.body).on('added_to_cart',function(e,fragments,cart_hash,btn){
        var eid=btn?ensureButtonEid(btn):makeEid();
        var name=btn&&btn.data('product_name')||'';
        var id=btn&&(btn.attr('data-overseek-content-id')||btn.data('product_id'))||'';
        var price=btn&&btn.data('product_price')||0;
        fireATC(name,String(id),parseFloat(price)||0,'{$this->get_currency_code()}',eid);
    });
    jQuery('form.variations_form')
        .on('found_variation',function(e,variation){
            if(variation&&variation.overseek_content_id){jQuery(this).find('input[name=overseek_content_id]').val(variation.overseek_content_id);}
        })
        .on('reset_data',function(){
            var input=jQuery(this).find('input[name=overseek_content_id]');
            input.val(input.attr('data-parent-content-id')||'');
        });
    jQuery('form.cart').on('submit',function(){
        var form=jQuery(this);
        var eidInput=form.find('input[name="overseek_event_id"]');
        var eid=eidInput.val()||makeEid();
        if(!eidInput.length){eidInput=jQuery('<input/>',{type:'hidden',name:'overseek_event_id'});form.append(eidInput);}
        eidInput.val(eid);
        var name=form.closest('.product').find('.product_title').text()||'';
        var id=form.find('input[name=overseek_content_id]').val()||form.find('input[name=product_id],button[name=add-to-cart]').val()||'';
        var price=form.closest('.product').find('.price ins .amount, .price > .amount').first().text().replace(/[^0-9.]/g,'')||0;
        fireATC(name.trim(),String(id),parseFloat(price)||0,'{$this->get_currency_code()}',String(eid));
    });
})();
JS;
	}

	/**
	 * Remove from cart — GA4 recommended event via AJAX listener.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	private function build_remove_from_cart_listener( array $config ): string {
		if ( empty( $config['ga4']['measurementId'] ) ) {
			return '';
		}

		return <<<'JS'
(function(){
if(!window.jQuery||!window.gtag){return;}
var jQuery=window.jQuery;
jQuery(document.body).on('removed_from_cart',function(e,fragments,hash,btn){
    var name=btn&&btn.data('product_name')||'';
    var id=btn&&btn.data('product_id')||'';
    gtag('event','remove_from_cart',{items:[{item_id:String(id),item_name:name}]});
});
})();
JS;
	}


	/**
	 * Add shipping info + add payment info — GA4 checkout step events.
	 * Fires via JS listeners on WC checkout form interactions.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	private function build_checkout_step_listeners( array $config ): string {
		if ( empty( $config['ga4']['measurementId'] ) ) {
			return '';
		}

		if ( ! function_exists( 'WC' ) || ! WC() || ! WC()->cart ) {
			return '';
		}

		$value    = (float) WC()->cart->get_total( 'edit' );
		$currency = esc_js( get_woocommerce_currency() );

		return <<<JS
(function(){
    if(!window.jQuery||!window.gtag){return;}
    var jQuery=window.jQuery;
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

	/**
	 * Build Search pixel events.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	private function build_search_events( array $config ): string {
		$query = get_search_query();
		$js    = '';
		if ( ! empty( $config['meta']['pixelId'] ) ) {
			$js .= "fbq('track','Search'," . wp_json_encode( array( 'search_string' => $query ) ) . ');';
		}
		if ( ! empty( $config['tiktok']['pixelCode'] ) ) {
			$js .= "ttq.track('Search'," . wp_json_encode( array( 'query' => $query ) ) . ');';
		}
		if ( ! empty( $config['snapchat']['pixelId'] ) ) {
			$js .= "snaptr('track','SEARCH'," . wp_json_encode( array( 'search_string' => $query ) ) . ');';
		}
		if ( ! empty( $config['ga4']['measurementId'] ) ) {
			$js .= "gtag('event','search'," . wp_json_encode( array( 'search_term' => $query ) ) . ');';
		}
		return $js;
	}

	// ─── Helpers ────────────────────────────────────────────────────────

	/**
	 * Check if an event is enabled for any platform.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @param string               $event_key Event toggle key.
	 * @return bool
	 */
	private function is_event_enabled( array $config, string $event_key ): bool {
		$has_events_config = false;
		foreach ( $config as $key => $platform_config ) {
			if ( '_consent' === $key ) {
				continue;
			}
			if ( ! is_array( $platform_config ) ) {
				continue;
			}
			if ( ! array_key_exists( 'events', $platform_config ) ) {
				continue;
			}
			$events = $platform_config['events'];
			if ( ! is_array( $events ) ) {
				continue;
			}
			$has_events_config = true;
			if ( ! array_key_exists( $event_key, $events ) || false !== $events[ $event_key ] ) {
				return true;
			}
		}
		return false === $has_events_config;
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
	private function get_pixel_config(): array {
		if ( null !== $this->config ) {
			return $this->config;
		}

		$this->config = OverSeek_Pixel_Config_Provider::get_config( $this->api_url, $this->account_id );

		return $this->config;
	}


	/**
	 * Get store currency code.
	 *
	 * @return string
	 */
	private function get_currency_code(): string {
		return OverSeek_Tracking_Event_Builder::get_currency();
	}
}
