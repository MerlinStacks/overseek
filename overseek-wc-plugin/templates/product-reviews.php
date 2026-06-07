<?php
/**
 * Overseek replacement for WooCommerce product reviews template.
 *
 * @package OverSeek
 * @since   2.17.0
 */

defined( 'ABSPATH' ) || exit;

$product_id = get_the_ID();
if ( ! $product_id || 'product' !== get_post_type( $product_id ) ) {
	return;
}

echo do_shortcode( '[overseek_product_reviews product_id="' . absint( $product_id ) . '" limit="12" pagination="load_more" show_media="1" add_review="1"]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
