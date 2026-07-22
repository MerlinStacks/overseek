<?php
/**
 * Ecommerce event builders for client-side pixels.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class OverSeek_Pixel_Ecommerce_Events.
 */
class OverSeek_Pixel_Ecommerce_Events {

	/**
	 * Build ViewContent events for product pages.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	public static function build_view_content_events( array $config ): string {
		global $product;
		if ( ! $product instanceof WC_Product ) {
			return '';
		}

		$content_id = OverSeek_Pixel_Matching_Utils::get_content_id( $product, $config );
		$value      = (float) $product->get_price();
		$currency   = OverSeek_Tracking_Event_Builder::get_currency();
		$name       = $product->get_name();
		$product_id = (int) $product->get_id();
		$event_id   = 'overseekProductViewEventId';

		$js = "var overseekProductViewEventId=window.overseekTakeProductViewEventId?window.overseekTakeProductViewEventId({$product_id}):('os_pv_'+Date.now().toString(36)+Math.random().toString(36).slice(2));";
		if ( self::is_platform_event_enabled( $config, 'meta', 'viewContent' ) ) {
			$js .= "fbq('track','ViewContent'," . wp_json_encode(
				array(
					'content_ids'  => array( $content_id ),
					'content_type' => 'product',
					'content_name' => $name,
					'value'        => $value,
					'currency'     => $currency,
				)
			) . ",{eventID:overseekProductViewEventId});";
		}
		if ( self::is_platform_event_enabled( $config, 'tiktok', 'viewContent' ) ) {
			$js .= "ttq.track('ViewContent'," . wp_json_encode(
				array(
					'content_id'   => $content_id,
					'content_type' => 'product',
					'content_name' => $name,
					'value'        => $value,
					'currency'     => $currency,
				)
			) . ",{event_id:overseekProductViewEventId});";
		}
		if ( self::is_platform_event_enabled( $config, 'pinterest', 'viewContent' ) ) {
			$js .= "pintrk('track','pagevisit'," . wp_json_encode(
				array(
					'product_id'   => $content_id,
					'product_name' => $name,
					'value'        => $value,
					'currency'     => $currency,
					'event_id'     => $event_id,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'snapchat', 'viewContent' ) ) {
			$js .= "snaptr('track','VIEW_CONTENT'," . wp_json_encode(
				array(
					'item_ids'  => array( $content_id ),
					'price'     => $value,
					'currency'  => $currency,
					'event_tag' => $event_id,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'ga4', 'viewContent' ) ) {
			$js .= "gtag('event','view_item'," . wp_json_encode(
				array(
					'items'    => array(
						array(
							'item_id'   => $content_id,
							'item_name' => $name,
							'price'     => $value,
						),
					),
					'value'    => $value,
					'currency' => $currency,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'google', 'viewContent' ) && ! empty( $config['google']['conversionLabelViewItem'] ) ) {
			$ads_cart_data = self::build_google_ads_cart_data(
				$config,
				array(
					array(
						'id'       => $content_id,
						'quantity' => 1,
						'price'    => $value,
					)
				)
			);
			$ads_payload   = array_merge(
				array(
					'send_to'  => $config['google']['conversionId'] . '/' . $config['google']['conversionLabelViewItem'],
					'value'    => $value,
					'currency' => $currency,
				),
				$ads_cart_data
			);
			$js           .= "gtag('event','conversion'," . wp_json_encode( $ads_payload ) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'microsoft', 'viewContent' ) ) {
			$js .= "window.uetq=window.uetq||[];window.uetq.push('event','page_view',{ecomm_prodid:'" . esc_js( $content_id ) . "',ecomm_pagetype:'product',revenue_value:" . $value . ",currency:'" . esc_js( $currency ) . "'});";
		}

		return str_replace( '"overseekProductViewEventId"', 'overseekProductViewEventId', $js );
	}

	/**
	 * Build view_item_list events for category and shop pages.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	public static function build_view_item_list_events( array $config ): string {
		if ( ! self::is_platform_event_enabled( $config, 'ga4', 'viewContent' ) ) {
			return '';
		}

		$items = array();
		global $wp_query;
		$term      = get_queried_object();
		$list_name = ( $term instanceof WP_Term ) ? $term->name : 'Shop';

		if ( ! empty( $wp_query->posts ) ) {
			$count = 0;
			foreach ( $wp_query->posts as $post ) {
				if ( $count >= 10 ) {
					break;
				}
				$product = wc_get_product( $post->ID );
				if ( ! $product || ! $product instanceof WC_Product ) {
					continue;
				}
				$items[] = array(
					'item_id'   => OverSeek_Pixel_Matching_Utils::get_content_id( $product, $config ),
					'item_name' => $product->get_name(),
					'price'     => (float) $product->get_price(),
					'index'     => $count,
				);
				++$count;
			}
		}

		if ( empty( $items ) ) {
			return '';
		}

		return "gtag('event','view_item_list'," . wp_json_encode(
			array(
				'item_list_name' => $list_name,
				'items'          => $items,
			)
		) . ');';
	}

	/**
	 * Build view_cart events for the cart page.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	public static function build_view_cart_events( array $config ): string {
		if ( ! self::is_platform_event_enabled( $config, 'ga4', 'addToCart' ) ) {
			return '';
		}

		if ( ! function_exists( 'WC' ) || ! WC() || ! WC()->cart ) {
			return '';
		}

		$cart = WC()->cart;
		if ( ! $cart ) {
			return '';
		}

		$items = array();
		foreach ( $cart->get_cart() as $item ) {
			$product = $item['data'] ?? null;
			if ( ! $product instanceof WC_Product ) {
				continue;
			}
			$items[] = array(
				'item_id'   => OverSeek_Pixel_Matching_Utils::get_content_id( $product, $config ),
				'item_name' => $product->get_name(),
				'price'     => (float) $product->get_price(),
				'quantity'  => (int) $item['quantity'],
			);
		}

		return "gtag('event','view_cart'," . wp_json_encode(
			array(
				'value'    => (float) $cart->get_total( 'edit' ),
				'currency' => OverSeek_Tracking_Event_Builder::get_currency(),
				'items'    => $items,
			)
		) . ');';
	}

	/**
	 * Build InitiateCheckout events for the checkout page.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	public static function build_initiate_checkout_events( array $config ): string {
		if ( ! function_exists( 'WC' ) || ! WC() || ! WC()->cart ) {
			return '';
		}

		$cart = WC()->cart;
		if ( ! $cart ) {
			return '';
		}

		$value                       = (float) $cart->get_total( 'edit' );
		$currency                    = OverSeek_Tracking_Event_Builder::get_currency();
		$num_items                   = $cart->get_cart_contents_count();
		$event_id                    = 'overseekCheckoutEventId';
		$google_begin_checkout_label = $config['google']['conversionLabelBeginCheckout'] ?? '';
		$cart_items                  = self::get_cart_ads_items( $cart, $config );

		$js = 'var overseekCheckoutEventId=window.overseekGetCheckoutEventId();';
		if ( self::is_platform_event_enabled( $config, 'meta', 'initiateCheckout' ) ) {
			$js .= "fbq('track','InitiateCheckout'," . wp_json_encode(
				array(
					'value'        => $value,
					'currency'     => $currency,
					'num_items'    => $num_items,
					'content_type' => 'product',
					'content_ids'  => array_column( $cart_items, 'id' ),
					'contents'     => self::build_meta_contents( $cart_items ),
				)
			) . ',{eventID:overseekCheckoutEventId});';
		}
		if ( self::is_platform_event_enabled( $config, 'tiktok', 'initiateCheckout' ) ) {
			$tt_content_ids = array_column( $cart_items, 'id' );
			$js .= "ttq.track('InitiateCheckout'," . wp_json_encode(
				array(
					'content_id'   => implode( ',', $tt_content_ids ),
					'content_type' => 'product',
					'contents'     => self::build_tiktok_contents( $cart_items ),
					'value'        => $value,
					'currency'     => $currency,
				)
			) . ',{event_id:overseekCheckoutEventId});';
		}
		if ( self::is_platform_event_enabled( $config, 'pinterest', 'initiateCheckout' ) ) {
			$js .= "pintrk('track','checkout'," . wp_json_encode(
				array(
					'value'          => $value,
					'currency'       => $currency,
					'order_quantity' => $num_items,
					'product_ids'    => array_column( $cart_items, 'id' ),
					'contents'       => self::build_pinterest_contents( $cart_items ),
					'event_id'       => $event_id,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'snapchat', 'initiateCheckout' ) ) {
			$js .= "snaptr('track','START_CHECKOUT'," . wp_json_encode(
				array(
					'price'        => $value,
					'currency'     => $currency,
					'number_items' => $num_items,
					'item_ids'     => array_column( $cart_items, 'id' ),
					'event_tag'    => $event_id,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'ga4', 'initiateCheckout' ) ) {
			$ga_items = array();
			foreach ( $cart_items as $item ) {
				$ga_items[] = array(
					'item_id'  => $item['id'],
					'quantity' => $item['quantity'],
					'price'    => $item['price'],
				);
			}
			$js .= "gtag('event','begin_checkout'," . wp_json_encode(
				array(
					'value'    => $value,
					'currency' => $currency,
					'items'    => $ga_items,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'google', 'initiateCheckout' ) && ! empty( $google_begin_checkout_label ) ) {
			$ads_payload  = array_merge(
				array(
					'send_to'  => $config['google']['conversionId'] . '/' . $google_begin_checkout_label,
					'value'    => $value,
					'currency' => $currency,
				),
				self::build_google_ads_cart_data( $config, $cart_items )
			);
			$js          .= "gtag('event','conversion'," . wp_json_encode( $ads_payload ) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'microsoft', 'initiateCheckout' ) ) {
			$js .= "window.uetq=window.uetq||[];window.uetq.push('event','begin_checkout',{revenue_value:" . $value . ",currency:'" . esc_js( $currency ) . "'});";
		}
		$js .= "(function(){if(!window.jQuery)return;var jQuery=window.jQuery;function setOverseekEventId(){var f=jQuery('form.checkout').first();if(!f.length)return;var i=f.find('input[name=\"overseek_event_id\"]');if(!i.length){i=jQuery('<input/>',{type:'hidden',name:'overseek_event_id'});f.append(i);}i.val(overseekCheckoutEventId);}setOverseekEventId();jQuery(document.body).on('updated_checkout',setOverseekEventId);})();";

		return str_replace( '"overseekCheckoutEventId"', 'overseekCheckoutEventId', $js );
	}

	/**
	 * Build Purchase events for the order received page.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return string
	 */
	public static function build_purchase_events( array $config ): string {
		global $wp;
		$order_id = isset( $wp->query_vars['order-received'] ) ? absint( $wp->query_vars['order-received'] ) : 0;
		if ( ! $order_id ) {
			return '';
		}

		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return '';
		}

		$order_key = isset( $_GET['key'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['key'] ) ) : '';
		$can_view_order = '' !== $order_key && hash_equals( (string) $order->get_order_key(), $order_key );
		if ( ! $can_view_order ) {
			$user_id = get_current_user_id();
			$can_view_order = $user_id > 0 && ( (int) $order->get_user_id() === $user_id || current_user_can( 'manage_woocommerce' ) );
		}
		if ( ! $can_view_order ) {
			return '';
		}

		$total    = (float) $order->get_total();
		$currency = $order->get_currency();
		$event_id = $order->get_meta( '_overseek_event_id' );
		if ( empty( $event_id ) ) {
			$event_id = wp_generate_uuid4();
			$order->update_meta_data( '_overseek_event_id', $event_id );
			$order->save();
		}

		$meta_total = $total;
		if ( ! empty( $config['meta']['excludeShipping'] ) ) {
			$meta_total -= (float) $order->get_shipping_total();
		}
		if ( ! empty( $config['meta']['excludeTax'] ) ) {
			$meta_total -= (float) $order->get_total_tax();
		}
		$meta_total = max( 0, round( $meta_total, 2 ) );

		$items = array();
		foreach ( $order->get_items() as $item ) {
			$product = $item->get_product();
			if ( ! $product ) {
				continue;
			}
			$items[] = array(
				'id'       => OverSeek_Pixel_Matching_Utils::get_content_id( $product, $config ),
				'name'     => $item->get_name(),
				'quantity' => $item->get_quantity(),
				'price'    => (float) $order->get_item_total( $item ),
			);
		}

		$js = '';
		if ( self::is_platform_event_enabled( $config, 'meta', 'purchase' ) ) {
			$content_ids = array_column( $items, 'id' );
			$js         .= "fbq('track','Purchase'," . wp_json_encode(
				array(
					'value'        => $meta_total,
					'currency'     => $currency,
					'content_ids'  => $content_ids,
					'content_type' => 'product',
					'num_items'    => count( $items ),
					'contents'     => self::build_meta_contents( $items ),
				)
			) . ",{eventID:'{$event_id}'});";
		}
		if ( self::is_platform_event_enabled( $config, 'tiktok', 'purchase' ) ) {
			$tt_content_ids = array_column( $items, 'id' );
			$js            .= "ttq.track('CompletePayment'," . wp_json_encode(
				array(
					'content_id'   => implode( ',', $tt_content_ids ),
					'content_type' => 'product',
					'contents'     => self::build_tiktok_contents( $items ),
					'value'        => $total,
					'currency'     => $currency,
				)
			) . ",{event_id:'{$event_id}'});";
		}
		if ( self::is_platform_event_enabled( $config, 'pinterest', 'purchase' ) ) {
			$product_ids = array_column( $items, 'id' );
			$js         .= "pintrk('track','checkout'," . wp_json_encode(
				array(
					'value'          => $total,
					'currency'       => $currency,
					'order_quantity' => count( $items ),
					'product_ids'    => $product_ids,
					'contents'       => self::build_pinterest_contents( $items ),
					'event_id'       => $event_id,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'snapchat', 'purchase' ) ) {
			$product_ids = array_column( $items, 'id' );
			$js         .= "snaptr('track','PURCHASE'," . wp_json_encode(
				array(
					'transaction_id' => (string) $order_id,
					'item_ids'       => $product_ids,
					'price'          => $total,
					'currency'       => $currency,
					'event_tag'      => $event_id,
				)
			) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'ga4', 'purchase' ) ) {
			$ga_items = array();
			foreach ( $items as $item ) {
				$ga_items[] = array(
					'item_id'   => $item['id'],
					'item_name' => $item['name'],
					'quantity'  => $item['quantity'],
					'price'     => $item['price'],
				);
			}
			$js .= "gtag('event','purchase'," . wp_json_encode(
				array(
					'transaction_id' => (string) $order_id,
					'value'          => $total,
					'currency'       => $currency,
					'items'          => $ga_items,
				)
			) . ');';
		}
		$purchase_label = $config['google']['conversionLabelPurchase'] ?? $config['google']['conversionLabel'] ?? '';
		if ( self::is_platform_event_enabled( $config, 'google', 'purchase' ) && ! empty( $purchase_label ) ) {
			$google_user_data = OverSeek_Pixel_Matching_Utils::get_google_user_data_params_from_order( $order );
			if ( ! empty( $google_user_data ) ) {
				$js .= "gtag('set','user_data'," . wp_json_encode( $google_user_data ) . ');';
			}

			$ads_payload = array_merge(
				array(
					'send_to'        => $config['google']['conversionId'] . '/' . $purchase_label,
					'value'          => $total,
					'currency'       => $currency,
					'transaction_id' => (string) $order_id,
				),
				self::build_google_ads_cart_data( $config, $items )
			);
			$js         .= "gtag('event','conversion'," . wp_json_encode( $ads_payload ) . ');';
		}
		if ( self::is_platform_event_enabled( $config, 'microsoft', 'purchase' ) ) {
			$js .= "window.uetq=window.uetq||[];window.uetq.push('event','purchase',{ecomm_prodid:" . wp_json_encode( array_column( $items, 'id' ) ) . ",ecomm_pagetype:'purchase',revenue_value:" . $total . ",currency:'" . esc_js( $currency ) . "',event_id:'{$event_id}'});";
		}
		$twitter_purchase_event_id = $config['twitter']['eventIdPurchase'] ?? '';
		if ( self::is_platform_event_enabled( $config, 'twitter', 'purchase' ) && ! empty( $twitter_purchase_event_id ) ) {
			$js .= "if(window.twq){twq('event','" . esc_js( $twitter_purchase_event_id ) . "',{value:" . $total . ",currency:'" . esc_js( $currency ) . "',conversion_id:'{$event_id}'});}";
		}

		return $js;
	}

	/**
	 * Build Google Ads cart data parameters for conversion tags.
	 *
	 * @param array<string, mixed> $config Pixel configuration.
	 * @param array<int, array<string, mixed>> $items Cart or order items.
	 * @return array<string, mixed>
	 */
	private static function build_google_ads_cart_data( array $config, array $items ): array {
		$cart_data = array();
		$ads_items = array();

		foreach ( $items as $item ) {
			$id = $item['id'] ?? $item['item_id'] ?? $item['productId'] ?? '';
			if ( '' === (string) $id ) {
				continue;
			}

			$ads_items[] = array(
				'id'       => (string) $id,
				'quantity' => max( 1, (int) ( $item['quantity'] ?? 1 ) ),
				'price'    => max( 0, (float) ( $item['price'] ?? 0 ) ),
			);
		}

		if ( ! empty( $ads_items ) ) {
			$cart_data['items'] = $ads_items;
		}

		if ( ! empty( $config['google']['merchantId'] ) ) {
			$cart_data['aw_merchant_id'] = (string) $config['google']['merchantId'];
		}
		if ( ! empty( $config['google']['feedCountry'] ) ) {
			$cart_data['aw_feed_country'] = strtoupper( (string) $config['google']['feedCountry'] );
		}
		if ( ! empty( $config['google']['feedLanguage'] ) ) {
			$cart_data['aw_feed_language'] = strtolower( (string) $config['google']['feedLanguage'] );
		}

		return $cart_data;
	}

	/**
	 * @param object $cart WooCommerce cart instance.
	 * @param array<string, mixed> $config Pixel configuration.
	 * @return array<int, array<string, mixed>>
	 */
	private static function get_cart_ads_items( $cart, array $config ): array {
		$items = array();

		foreach ( $cart->get_cart() as $cart_item ) {
			$product = $cart_item['data'] ?? null;
			if ( ! $product instanceof WC_Product ) {
				continue;
			}

			$items[] = array(
				'id'       => OverSeek_Pixel_Matching_Utils::get_content_id( $product, $config ),
				'name'     => $product->get_name(),
				'quantity' => (int) ( $cart_item['quantity'] ?? 1 ),
				'price'    => (float) $product->get_price(),
			);
		}

		return $items;
	}

	/**
	 * @param array<int, array<string, mixed>> $items Ecommerce items.
	 * @return array<int, array<string, mixed>>
	 */
	private static function build_meta_contents( array $items ): array {
		return array_map(
			static function ( array $item ): array {
				return array(
					'id'         => (string) ( $item['id'] ?? '' ),
					'quantity'   => max( 1, (int) ( $item['quantity'] ?? 1 ) ),
					'item_price' => max( 0, (float) ( $item['price'] ?? 0 ) ),
				);
			},
			$items
		);
	}

	/**
	 * @param array<int, array<string, mixed>> $items Ecommerce items.
	 * @return array<int, array<string, mixed>>
	 */
	private static function build_tiktok_contents( array $items ): array {
		return array_map(
			static function ( array $item ): array {
				return array(
					'content_id'   => (string) ( $item['id'] ?? '' ),
					'content_type' => 'product',
					'content_name' => (string) ( $item['name'] ?? '' ),
					'quantity'     => max( 1, (int) ( $item['quantity'] ?? 1 ) ),
					'price'        => max( 0, (float) ( $item['price'] ?? 0 ) ),
				);
			},
			$items
		);
	}

	/**
	 * @param array<int, array<string, mixed>> $items Ecommerce items.
	 * @return array<int, array<string, mixed>>
	 */
	private static function build_pinterest_contents( array $items ): array {
		return array_map(
			static function ( array $item ): array {
				return array(
					'id'         => (string) ( $item['id'] ?? '' ),
					'item_name'  => (string) ( $item['name'] ?? '' ),
					'quantity'   => max( 1, (int) ( $item['quantity'] ?? 1 ) ),
					'item_price' => (string) max( 0, (float) ( $item['price'] ?? 0 ) ),
				);
			},
			$items
		);
	}

	/**
	 * Check credentials and the platform-specific event switch.
	 */
	public static function is_platform_event_enabled( array $config, string $platform, string $event_key ): bool {
		$id_keys = array(
			'meta' => 'pixelId',
			'tiktok' => 'pixelCode',
			'pinterest' => 'tagId',
			'snapchat' => 'pixelId',
			'ga4' => 'measurementId',
			'google' => 'conversionId',
			'microsoft' => 'tagId',
			'twitter' => 'pixelId',
		);
		$id_key = $id_keys[ $platform ] ?? '';
		if ( '' === $id_key || empty( $config[ $platform ][ $id_key ] ) ) {
			return false;
		}

		$events = $config[ $platform ]['events'] ?? null;

		return ! is_array( $events ) || ! array_key_exists( $event_key, $events ) || false !== $events[ $event_key ];
	}
}
