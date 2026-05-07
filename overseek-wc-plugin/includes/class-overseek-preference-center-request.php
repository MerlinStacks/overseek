<?php
/**
 * Request and page-discovery helpers for the OverSeek preference center.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OverSeek_Preference_Center_Request {
	public static function get_request_token( string $query_key ): string {
		if ( ! isset( $_GET[ $query_key ] ) ) {
			return '';
		}

		return sanitize_text_field( wp_unslash( $_GET[ $query_key ] ) );
	}

	public static function is_valid_submission( string $nonce_name, string $nonce_action ): bool {
		if ( ! isset( $_POST[ $nonce_name ] ) ) {
			return false;
		}

		$nonce = sanitize_text_field( wp_unslash( $_POST[ $nonce_name ] ) );

		return wp_verify_nonce( $nonce, $nonce_action ) !== false;
	}

	public static function current_request_uses_embedded_preference_center( string $shortcode_tag ): bool {
		$post = get_queried_object();
		if ( ! ( $post instanceof WP_Post ) ) {
			return false;
		}

		$content = (string) $post->post_content;

		if ( has_shortcode( $content, $shortcode_tag ) ) {
			return true;
		}

		if ( function_exists( 'has_block' ) && has_block( 'overseek/preference-center', $post ) ) {
			return true;
		}

		return false;
	}

	public static function find_embedded_preference_center_page_url( string $shortcode_tag ): ?string {
		$pages = get_posts(
			[
				'post_type'      => [ 'page', 'post' ],
				'post_status'    => 'publish',
				'posts_per_page' => 20,
				'orderby'        => 'date',
				'order'          => 'DESC',
			]
		);

		foreach ( $pages as $page ) {
			if ( ! ( $page instanceof WP_Post ) ) {
				continue;
			}

			$content = (string) $page->post_content;
			$has_shortcode = has_shortcode( $content, $shortcode_tag );
			$has_block_match = function_exists( 'has_block' ) && has_block( 'overseek/preference-center', $page );

			if ( ! $has_shortcode && ! $has_block_match ) {
				continue;
			}

			$permalink = get_permalink( $page );
			if ( $permalink ) {
				return $permalink;
			}
		}

		return null;
	}
}
