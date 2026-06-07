<?php
/**
 * Storefront review markup renderer.
 *
 * @package OverSeek
 * @since   2.17.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Shared renderer for review shortcodes, blocks, and product-page modules.
 */
class OverSeek_Review_Renderer {
	/**
	 * Render a review summary block.
	 *
	 * @param array<string, mixed> $summary Summary data.
	 * @param array<string, mixed> $context Display context.
	 * @return string
	 */
	public static function render_summary( array $summary, array $context = [] ): string {
		if ( isset( $context['store_summary'] ) && is_array( $context['store_summary'] ) ) {
			$summary = $context['store_summary'];
		}

		$total           = isset( $summary['total'] ) ? (int) $summary['total'] : 0;
		$rating          = isset( $summary['average'] ) ? (float) $summary['average'] : 0.0;
		$store_name      = ! empty( $context['store_name'] ) ? (string) $context['store_name'] : get_bloginfo( 'name' );
		$product_summary = isset( $context['product_summary'] ) && is_array( $context['product_summary'] ) ? $context['product_summary'] : [];
		$product_total   = isset( $product_summary['total'] ) ? (int) $product_summary['total'] : 0;
		$product_rating  = $product_total > 0 && isset( $product_summary['average'] ) ? (float) $product_summary['average'] : $rating;

		ob_start();
		?>
		<div class="os-reviews-summary" aria-label="<?php echo esc_attr( sprintf( 'Average rating %.1f out of 5 from %d reviews', $rating, $total ) ); ?>">
			<div class="os-reviews-summary__brand">
				<span class="os-reviews-summary__badge" aria-hidden="true"></span>
				<div>
					<strong><?php echo esc_html( $store_name ); ?></strong>
					<span><?php echo esc_html( sprintf( _n( '%d review', '%d reviews', $total, 'overseek-wc' ), $total ) ); ?></span>
					<small><?php esc_html_e( 'what our customers say', 'overseek-wc' ); ?></small>
				</div>
			</div>
			<div class="os-reviews-summary__ratings">
				<div class="os-reviews-summary__rating">
					<?php echo self::render_stars( $rating ); ?>
					<span><?php esc_html_e( 'Store rating', 'overseek-wc' ); ?></span>
					<strong><?php echo esc_html( number_format_i18n( $rating, 2 ) ); ?> / 5</strong>
				</div>
				<div class="os-reviews-summary__rating">
					<?php echo self::render_stars( $product_rating ); ?>
					<span><?php esc_html_e( 'Product rating', 'overseek-wc' ); ?></span>
					<strong><?php echo esc_html( number_format_i18n( $product_rating, 2 ) ); ?> / 5</strong>
				</div>
			</div>
		</div>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Render a list of reviews.
	 *
	 * @param array<int, array<string, mixed>> $reviews Review rows.
	 * @param array<string, mixed>             $args    Render arguments.
	 * @return string
	 */
	public static function render_reviews( array $reviews, array $args = [] ): string {
		$layout       = isset( $args['layout'] ) ? sanitize_key( (string) $args['layout'] ) : 'grid';
		$columns      = isset( $args['columns'] ) ? max( 1, min( 4, (int) $args['columns'] ) ) : 3;
		$show_product = self::truthy( $args['show_product'] ?? true );
		$show_media   = self::truthy( $args['show_media'] ?? true );
		$show_replies = self::truthy( $args['show_replies'] ?? true );

		if ( empty( $reviews ) ) {
			return '<div class="os-reviews-empty">' . esc_html__( 'No reviews found yet.', 'overseek-wc' ) . '</div>';
		}

		$classes = [ 'os-reviews-list', 'os-reviews-list--' . $layout ];
		$style   = 'grid' === $layout ? sprintf( '--os-review-columns:%d;', $columns ) : '';
		$style  .= self::render_color_vars( $args );
		$style  .= self::render_style_vars( $args );

		ob_start();
		?>
		<div class="<?php echo esc_attr( implode( ' ', $classes ) ); ?>" style="<?php echo esc_attr( $style ); ?>">
			<?php foreach ( $reviews as $review ) : ?>
				<?php echo self::render_review_card( $review, $show_product, $show_media, $show_replies, $args ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
			<?php endforeach; ?>
		</div>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Render a compact row list of reviews.
	 *
	 * @param array<int, array<string, mixed>> $reviews Review rows.
	 * @param array<string, mixed>             $args    Render arguments.
	 * @return string
	 */
	public static function render_rows( array $reviews, array $args = [] ): string {
		$show_product  = self::truthy( $args['show_product'] ?? true );
		$show_reviewer = self::truthy( $args['show_reviewer'] ?? true );
		$show_verified = self::truthy( $args['show_verified'] ?? true );
		$show_country  = self::truthy( $args['show_country'] ?? true );
		$show_date     = self::truthy( $args['show_date'] ?? true );
		$max_chars     = isset( $args['max_chars'] ) ? (int) $args['max_chars'] : 0;

		if ( empty( $reviews ) ) {
			return '<div class="os-reviews-empty">' . esc_html__( 'No reviews found yet.', 'overseek-wc' ) . '</div>';
		}

		ob_start();
		?>
		<div class="os-review-rows">
			<?php foreach ( $reviews as $review ) : ?>
				<?php
				$rating   = isset( $review['rating'] ) ? (float) $review['rating'] : 0.0;
				$content  = isset( $review['content'] ) ? (string) $review['content'] : '';
				$reviewer = isset( $review['reviewer'] ) ? (string) $review['reviewer'] : __( 'Customer', 'overseek-wc' );
				$country  = isset( $review['country'] ) ? (string) $review['country'] : '';
				if ( $max_chars > 0 && strlen( wp_strip_all_tags( $content ) ) > $max_chars ) {
					$content = mb_substr( $content, 0, $max_chars ) . '…';
				}
				?>
				<article class="os-review-row">
					<div class="os-review-row__rating"><?php echo self::render_stars( $rating ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
					<div class="os-review-row__content">
						<p><?php echo esc_html( wp_trim_words( $content, 28 ) ); ?></p>
						<div class="os-review-row__meta">
							<?php if ( $show_reviewer ) : ?>
								<span><?php echo esc_html( $reviewer ); ?></span>
							<?php endif; ?>
							<?php if ( $show_product && ! empty( $review['product_name'] ) ) : ?>
								<span><?php echo esc_html( (string) $review['product_name'] ); ?></span>
							<?php endif; ?>
							<?php if ( $show_verified && ! empty( $review['verified'] ) ) : ?>
								<span><?php esc_html_e( 'Verified owner', 'overseek-wc' ); ?></span>
							<?php endif; ?>
							<?php if ( $show_country && '' !== $country ) : ?>
								<span><?php echo esc_html( self::country_flag( $country ) . ' ' . strtoupper( $country ) ); ?></span>
							<?php endif; ?>
							<?php if ( $show_date && ! empty( $review['date'] ) ) : ?>
								<span><?php echo esc_html( (string) $review['date'] ); ?></span>
							<?php endif; ?>
						</div>
					</div>
				</article>
			<?php endforeach; ?>
		</div>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Render an individual review card.
	 *
	 * @param array<string, mixed> $review       Review data.
	 * @param bool                 $show_product Whether to show product details.
	 * @param bool                 $show_media   Whether to show media.
	 * @return string
	 */
	private static function render_review_card( array $review, bool $show_product, bool $show_media, bool $show_replies = true, array $args = [] ): string {
		$rating        = isset( $review['rating'] ) ? (float) $review['rating'] : 0.0;
		$reviewer      = isset( $review['reviewer'] ) ? (string) $review['reviewer'] : __( 'Customer', 'overseek-wc' );
		$content       = isset( $review['content'] ) ? (string) $review['content'] : '';
		$max_chars     = isset( $args['max_chars'] ) ? (int) $args['max_chars'] : 0;
		$product_image = isset( $review['product_image'] ) ? (string) $review['product_image'] : '';
		$show_product_image = self::truthy( $args['show_product_image'] ?? true );
		$show_reviewer = self::truthy( $args['show_reviewer'] ?? true );
		$show_verified = self::truthy( $args['show_verified'] ?? true );
		$show_country  = self::truthy( $args['show_country'] ?? true );
		$show_date     = self::truthy( $args['show_date'] ?? true );
		$card_style    = isset( $args['card_style'] ) ? sanitize_key( (string) $args['card_style'] ) : 'comfortable';
		$product_class = 'os-review-card__product' . ( ! $show_product_image || '' === $product_image ? ' os-review-card__product--no-image' : '' );
		if ( $max_chars > 0 && strlen( wp_strip_all_tags( $content ) ) > $max_chars ) {
			$content = mb_substr( $content, 0, $max_chars ) . '…';
		}
		$verified = ! empty( $review['verified'] );
		$media    = isset( $review['media'] ) && is_array( $review['media'] ) ? $review['media'] : [];
		$replies  = isset( $review['replies'] ) && is_array( $review['replies'] ) ? $review['replies'] : [];
		$country  = isset( $review['country'] ) ? (string) $review['country'] : '';
		ob_start();
		?>
		<article class="os-review-card os-review-card--<?php echo esc_attr( $card_style ); ?>">
			<header class="os-review-card__header">
				<div class="os-review-card__reviewer">
					<?php echo $show_reviewer ? self::render_avatar( $reviewer, $args['avatars'] ?? 'initials' ) : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
					<div>
						<?php if ( $show_reviewer ) : ?>
							<strong class="os-review-card__author"><?php echo esc_html( $reviewer ); ?></strong>
						<?php endif; ?>
						<div class="os-review-card__meta">
							<?php if ( $show_verified && $verified ) : ?>
								<span class="os-review-card__verified"><?php esc_html_e( 'Verified', 'overseek-wc' ); ?></span>
							<?php endif; ?>
							<?php if ( $show_country && '' !== $country ) : ?>
								<span class="os-review-card__country"><?php echo esc_html( self::country_flag( $country ) . ' ' . strtoupper( $country ) ); ?></span>
							<?php endif; ?>
						</div>
					</div>
				</div>
				<?php if ( $show_date && ! empty( $review['date'] ) ) : ?>
					<time datetime="<?php echo esc_attr( isset( $review['date_iso'] ) ? (string) $review['date_iso'] : '' ); ?>"><?php echo esc_html( (string) $review['date'] ); ?></time>
				<?php endif; ?>
			</header>

			<div class="os-review-card__stars"><?php echo self::render_stars( $rating ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
			<div class="os-review-card__content"><?php echo wp_kses_post( wpautop( $content ) ); ?></div>

			<?php if ( $show_replies && ! empty( $replies ) ) : ?>
				<div class="os-review-card__replies">
					<?php foreach ( $replies as $reply ) : ?>
						<?php if ( is_array( $reply ) && ! empty( $reply['content'] ) ) : ?>
							<div class="os-review-card__reply">
								<strong><?php echo esc_html( ! empty( $reply['author'] ) ? (string) $reply['author'] : __( 'Store reply', 'overseek-wc' ) ); ?></strong>
								<?php echo wp_kses_post( wpautop( (string) $reply['content'] ) ); ?>
							</div>
						<?php endif; ?>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>

			<?php if ( $show_media && ! empty( $media ) ) : ?>
				<div class="os-review-card__media">
					<?php foreach ( $media as $item ) : ?>
						<?php echo self::render_media_item( $item ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>

			<?php if ( $show_product && ! empty( $review['product_name'] ) ) : ?>
				<footer class="<?php echo esc_attr( $product_class ); ?>">
					<?php if ( $show_product_image && '' !== $product_image ) : ?>
						<img src="<?php echo esc_url( $product_image ); ?>" alt="" loading="lazy">
					<?php endif; ?>
					<?php if ( self::truthy( $args['product_links'] ?? true ) && ! empty( $review['product_url'] ) ) : ?>
						<a href="<?php echo esc_url( (string) $review['product_url'] ); ?>"><?php echo esc_html( (string) $review['product_name'] ); ?></a>
					<?php else : ?>
						<span><?php echo esc_html( (string) $review['product_name'] ); ?></span>
					<?php endif; ?>
				</footer>
			<?php endif; ?>
		</article>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Render a simple avatar treatment.
	 *
	 * @param string $name Reviewer name.
	 * @param mixed  $mode Avatar mode.
	 * @return string
	 */
	private static function render_avatar( string $name, $mode ): string {
		$mode = sanitize_key( (string) $mode );
		if ( in_array( $mode, [ 'hidden', 'false', '0' ], true ) ) {
			return '';
		}

		$initial = strtoupper( substr( trim( $name ), 0, 1 ) ?: 'C' );
		return '<span class="os-review-card__avatar" aria-hidden="true">' . esc_html( $initial ) . '</span>';
	}

	/**
	 * Render CSS variables from CusRev-compatible color args.
	 *
	 * @param array<string, mixed> $args Args.
	 * @return string
	 */
	private static function render_color_vars( array $args ): string {
		$map = [
			'color_brdr'    => '--os-review-card-border',
			'color_bcrd'    => '--os-review-card-bg',
			'color_pr_bcrd' => '--os-review-product-bg',
			'color_stars'   => '--os-review-star-color',
		];
		$out = '';

		foreach ( $map as $key => $var ) {
			if ( empty( $args[ $key ] ) ) {
				continue;
			}

			$color = sanitize_hex_color( (string) $args[ $key ] );
			if ( $color ) {
				$out .= $var . ':' . $color . ';';
				if ( 'color_brdr' === $key ) {
					$out .= '--os-review-accent-1:' . $color . ';--os-review-accent-2:' . $color . ';--os-review-accent-3:' . $color . ';';
				}
			}
		}

		return $out;
	}

	/**
	 * Render style-related CSS variables.
	 *
	 * @param array<string, mixed> $args Args.
	 * @return string
	 */
	private static function render_style_vars( array $args ): string {
		$out = '';
		if ( isset( $args['radius'] ) ) {
			$out .= '--os-review-card-radius:' . max( 8, min( 40, (int) $args['radius'] ) ) . 'px;';
		}
		if ( isset( $args['shadow'] ) ) {
			$shadow = max( 0, min( 3, (int) $args['shadow'] ) );
			$shadows = [
				'none',
				'0 10px 28px rgba(15, 23, 42, 0.06)',
				'0 20px 55px rgba(15, 23, 42, 0.08)',
				'0 28px 80px rgba(15, 23, 42, 0.12)',
			];
			$hover_shadows = [
				'none',
				'0 12px 34px rgba(15, 23, 42, 0.09)',
				'0 24px 70px rgba(15, 23, 42, 0.12)',
				'0 34px 95px rgba(15, 23, 42, 0.16)',
			];
			$out .= '--os-review-card-shadow:' . $shadows[ $shadow ] . ';--os-review-card-shadow-hover:' . $hover_shadows[ $shadow ] . ';';
		}
		if ( isset( $args['slider_desktop'] ) ) {
			$out .= '--os-review-slider-desktop:' . max( 1, min( 5, (int) $args['slider_desktop'] ) ) . ';';
		}
		if ( isset( $args['slider_mobile'] ) ) {
			$out .= '--os-review-slider-mobile:' . max( 1, min( 2, (int) $args['slider_mobile'] ) ) . ';';
		}

		return $out;
	}

	/**
	 * Render review stars.
	 *
	 * @param float $rating Rating value.
	 * @return string
	 */
	private static function render_stars( float $rating ): string {
		$rating = max( 0.0, min( 5.0, $rating ) );
		$full   = (int) floor( $rating );
		$stars  = str_repeat( '★', $full ) . str_repeat( '☆', 5 - $full );

		return sprintf(
			'<span class="os-review-stars" aria-label="%s">%s</span>',
			esc_attr( sprintf( 'Rated %.1f out of 5', $rating ) ),
			esc_html( $stars )
		);
	}

	/**
	 * Render a review media item.
	 *
	 * @param mixed $item Media item.
	 * @return string
	 */
	private static function render_media_item( $item ): string {
		if ( ! is_array( $item ) || empty( $item['url'] ) ) {
			return '';
		}

		$type = isset( $item['type'] ) ? (string) $item['type'] : '';
		$url  = (string) $item['url'];

		if ( 0 === strpos( $type, 'video/' ) ) {
			return sprintf( '<video class="os-review-media" src="%s" controls preload="metadata"></video>', esc_url( $url ) );
		}

		$alt = isset( $item['filename'] ) && '' !== (string) $item['filename'] ? (string) $item['filename'] : __( 'Review media', 'overseek-wc' );

		return sprintf(
			'<a href="%s" target="_blank" rel="noopener"><img class="os-review-media" src="%s" alt="%s" loading="lazy"></a>',
			esc_url( $url ),
			esc_url( $url ),
			esc_attr( $alt )
		);
	}

	/**
	 * Convert ISO country code to a flag glyph.
	 *
	 * @param string $country Two-letter country code.
	 * @return string
	 */
	private static function country_flag( string $country ): string {
		$country = strtoupper( substr( preg_replace( '/[^A-Z]/i', '', $country ), 0, 2 ) );
		$flags = [
			'AU' => '🇦🇺',
			'CA' => '🇨🇦',
			'DE' => '🇩🇪',
			'ES' => '🇪🇸',
			'FR' => '🇫🇷',
			'GB' => '🇬🇧',
			'IE' => '🇮🇪',
			'NZ' => '🇳🇿',
			'US' => '🇺🇸',
		];

		return $flags[ $country ] ?? '🌐';
	}

	/**
	 * Normalize boolean-like shortcode values.
	 *
	 * @param mixed $value Value to normalize.
	 * @return bool
	 */
	private static function truthy( $value ): bool {
		if ( is_bool( $value ) ) {
			return $value;
		}

		return ! in_array( strtolower( (string) $value ), [ '0', 'false', 'no', 'off' ], true );
	}
}
