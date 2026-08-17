<?php
/**
 * Shared incoming-review moderation policy.
 *
 * @package OverSeek
 * @since   2.21.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Resolves the initial WordPress approval state for a review.
 */
class OverSeek_Review_Moderation {
	/**
	 * Apply the configured policy without promoting a review WordPress has held.
	 *
	 * @param int|string|WP_Error $approved    Approval state determined by WordPress.
	 * @param array               $commentdata Incoming comment data.
	 * @return int|string|WP_Error
	 */
	public static function filter_approval( $approved, array $commentdata ) {
		if ( is_wp_error( $approved ) || in_array( $approved, [ 'spam', 'trash' ], true ) || ! self::is_review( $commentdata ) ) {
			return $approved;
		}

		$rating = self::get_rating( $commentdata );
		if ( $rating < 1 || $rating > 5 ) {
			return $approved;
		}

		$config    = get_option( 'overseek_storefront_review_config', [] );
		$mode      = is_array( $config ) && isset( $config['moderationMode'] ) ? sanitize_key( (string) $config['moderationMode'] ) : '';
		$threshold = is_array( $config ) && isset( $config['moderationThreshold'] ) ? absint( $config['moderationThreshold'] ) : 4;
		$threshold = max( 1, min( 5, $threshold ) );
		if ( '' === $mode ) {
			// Existing OverSeek forms historically submitted reviews as pending.
			// Preserve that behaviour until settings have explicitly been synced.
			return 0;
		}

		if ( 'hold_all' === $mode ) {
			return 0;
		}

		if ( 'hold_below' === $mode ) {
			return $rating < $threshold ? 0 : $approved;
		}

		// Auto-publish means following WordPress's normal approval result. A hold
		// from core, moderation settings, or another security plugin is preserved.
		return $approved;
	}

	/**
	 * Check whether incoming comment data represents a review.
	 *
	 * @param array<string, mixed> $commentdata Incoming comment data.
	 * @return bool
	 */
	private static function is_review( array $commentdata ): bool {
		$type = isset( $commentdata['comment_type'] ) ? (string) $commentdata['comment_type'] : '';
		if ( 'review' === $type ) {
			return true;
		}

		$post_id = isset( $commentdata['comment_post_ID'] ) ? absint( $commentdata['comment_post_ID'] ) : 0;
		return $post_id > 0 && 'product' === get_post_type( $post_id );
	}

	/**
	 * Read a rating from API, custom form, or native WooCommerce comment data.
	 *
	 * @param array<string, mixed> $commentdata Incoming comment data.
	 * @return int
	 */
	private static function get_rating( array $commentdata ): int {
		if ( isset( $commentdata['comment_meta']['rating'] ) ) {
			return absint( $commentdata['comment_meta']['rating'] );
		}
		if ( isset( $commentdata['rating'] ) ) {
			return absint( $commentdata['rating'] );
		}
		return isset( $_POST['rating'] ) ? absint( wp_unslash( $_POST['rating'] ) ) : 0;
	}
}
