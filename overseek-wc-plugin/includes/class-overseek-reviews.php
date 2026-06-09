<?php
/**
 * Native WooCommerce review storefront features.
 *
 * @package OverSeek
 * @since   2.17.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers review shortcodes and exposes native WooCommerce review queries.
 */
class OverSeek_Reviews {
	/**
	 * Shortcodes handled by this feature.
	 *
	 * @var array<int, string>
	 */
	private array $shortcodes = [
		'overseek_reviews',
		'overseek_review_slider',
		'overseek_review_rows',
		'overseek_product_reviews',
		'overseek_review_summary',
		'overseek_review_stars',
		'overseek_review_form',
		'cusrev_all_reviews',
		'cusrev_reviews_grid',
		'cusrev_reviews_slider',
		'cusrev_reviews_rating',
		'cusrev_review_button',
		'cusrev_qna',
	];

	/**
	 * Rendered review shell counter.
	 *
	 * @var int
	 */
	private int $shell_counter = 0;

	/**
	 * Initialize hooks.
	 */
	public function __construct() {
		add_action( 'init', [ $this, 'register_shortcodes' ] );
		add_action( 'init', [ $this, 'register_blocks' ] );
		add_action( 'wp_enqueue_scripts', [ $this, 'maybe_enqueue_assets' ] );
	}

	/**
	 * Register review shortcodes.
	 *
	 * @return void
	 */
	public function register_shortcodes(): void {
		add_shortcode( 'overseek_reviews', [ $this, 'render_reviews_shortcode' ] );
		add_shortcode( 'overseek_review_slider', [ $this, 'render_slider_shortcode' ] );
		add_shortcode( 'overseek_product_reviews', [ $this, 'render_product_reviews_shortcode' ] );
		add_shortcode( 'overseek_review_rows', [ $this, 'render_rows_shortcode' ] );
		add_shortcode( 'overseek_review_summary', [ $this, 'render_summary_shortcode' ] );
		add_shortcode( 'overseek_review_stars', [ $this, 'render_review_stars_shortcode' ] );
		add_shortcode( 'cusrev_all_reviews', [ $this, 'render_cusrev_all_reviews_shortcode' ] );
		add_shortcode( 'cusrev_reviews_grid', [ $this, 'render_cusrev_grid_shortcode' ] );
		add_shortcode( 'cusrev_reviews_slider', [ $this, 'render_cusrev_slider_shortcode' ] );
		add_shortcode( 'cusrev_reviews_rating', [ $this, 'render_cusrev_rating_shortcode' ] );
		add_shortcode( 'cusrev_review_button', [ $this, 'render_cusrev_review_button_shortcode' ] );
		add_shortcode( 'cusrev_qna', [ $this, 'render_cusrev_qna_shortcode' ] );
	}

	/**
	 * Register dynamic review blocks.
	 *
	 * @return void
	 */
	public function register_blocks(): void {
		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}

		$block_slugs = [
			'reviews',
			'review-slider',
			'review-rows',
			'product-reviews',
			'review-summary',
			'review-form',
		];

		foreach ( $block_slugs as $slug ) {
			$block_dir = OVERSEEK_WC_PLUGIN_DIR . 'blocks/' . $slug;
			if ( ! file_exists( $block_dir . '/block.json' ) ) {
				continue;
			}

			register_block_type(
				$block_dir,
				[
					'render_callback' => [ $this, 'render_block' ],
				]
			);
		}
	}

	/**
	 * Render dynamic review blocks.
	 *
	 * @param array<string, mixed> $attributes Block attributes.
	 * @param string               $content Block content.
	 * @param WP_Block|null        $block Block instance.
	 * @return string
	 */
	public function render_block( array $attributes = [], string $content = '', ?WP_Block $block = null ): string {
		$block_name = $block instanceof WP_Block ? $block->name : '';

		if ( 'overseek/review-rows' === $block_name ) {
			return $this->render_rows_shortcode( $attributes );
		}

		if ( 'overseek/review-slider' === $block_name ) {
			return $this->render_slider_shortcode( $attributes );
		}

		if ( 'overseek/product-reviews' === $block_name ) {
			if ( ! isset( $attributes['add_review'] ) ) {
				$attributes['add_review'] = '1';
			}
			return $this->render_product_reviews_shortcode( $attributes );
		}

		if ( 'overseek/review-summary' === $block_name ) {
			return $this->render_summary_shortcode( $attributes );
		}

		if ( 'overseek/review-form' === $block_name ) {
			$product_id = isset( $attributes['product_id'] ) ? absint( $attributes['product_id'] ) : 0;
			$title      = isset( $attributes['title'] ) ? sanitize_text_field( (string) $attributes['title'] ) : 'Write a review';
			if ( $this->is_block_editor_preview_request() && ! $product_id ) {
				return $this->render_mock_review_form( $title );
			}
			return do_shortcode( sprintf( '[overseek_review_form product_id="%d" title="%s"]', $product_id, esc_attr( $title ) ) );
		}

		return $this->render_reviews_shortcode( $attributes );
	}

	/**
	 * Enqueue public review CSS when a review shortcode is present or on product pages.
	 *
	 * @return void
	 */
	public function maybe_enqueue_assets(): void {
		if ( function_exists( 'is_product' ) && is_product() ) {
			$this->enqueue_assets();
			return;
		}

		$post = get_queried_object();
		if ( ! ( $post instanceof WP_Post ) ) {
			return;
		}

		$content = (string) $post->post_content;
		foreach ( $this->shortcodes as $shortcode ) {
			if ( has_shortcode( $content, $shortcode ) ) {
				$this->enqueue_assets();
				return;
			}
		}

		$blocks = [
			'overseek/reviews',
			'overseek/review-slider',
			'overseek/review-rows',
			'overseek/product-reviews',
			'overseek/review-summary',
			'overseek/review-form',
		];

		foreach ( $blocks as $block_name ) {
			if ( function_exists( 'has_block' ) && has_block( $block_name, $post ) ) {
				$this->enqueue_assets();
				return;
			}
		}
	}

	/**
	 * Enqueue review styles.
	 *
	 * @return void
	 */
	private function enqueue_assets(): void {
		wp_enqueue_style(
			'overseek-reviews',
			OVERSEEK_WC_PLUGIN_URL . 'assets/reviews.css',
			[],
			OVERSEEK_WC_VERSION
		);

		$colors = $this->get_review_brand_colors();
		wp_add_inline_style(
			'overseek-reviews',
			sprintf(
				'.os-reviews-shell{--os-review-accent-1:%1$s;--os-review-accent-2:%2$s;--os-review-accent-3:%3$s;--os-review-star-color:%1$s;}',
				esc_html( $colors['primary'] ),
				esc_html( $colors['secondary'] ),
				esc_html( $colors['tertiary'] )
			)
		);

		wp_enqueue_script(
			'overseek-reviews',
			OVERSEEK_WC_PLUGIN_URL . 'assets/reviews.js',
			[],
			OVERSEEK_WC_VERSION,
			true
		);
	}

	/**
	 * Render the main review list shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_reviews_shortcode( $atts = [] ): string {
		$atts    = $this->normalize_shortcode_atts( $atts );
		$args    = $this->normalize_shortcode_args( $atts, 'overseek_reviews' );
		$reviews = $this->get_reviews( $args );
		$summary = $this->get_summary( $args );
		if ( empty( $reviews ) && $this->is_block_editor_preview_request() ) {
			$reviews = $this->get_mock_reviews( $args );
			$summary = $this->get_mock_summary();
		}
		$shell_id = 'os-reviews-' . ++$this->shell_counter;

		return '<div id="' . esc_attr( $shell_id ) . '" class="os-reviews-shell" data-os-reviews-shell>'
			. ( $this->truthy( $args['show_summary_bar'] ?? '1' ) ? OverSeek_Review_Renderer::render_summary( $summary, $this->get_summary_context( $args, $summary ) ) : '' )
			. $this->render_schema_markup( $summary, $args )
			. OverSeek_Review_Renderer::render_reviews( $reviews, $args )
			. $this->render_pagination( $summary, $args )
			. $this->maybe_render_add_review_form( $args )
			. '</div>';
	}

	/**
	 * CusRev-compatible all reviews shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_cusrev_all_reviews_shortcode( $atts = [] ): string {
		$atts = $this->normalize_shortcode_atts( $atts );
		$atts = $this->map_cusrev_args( $atts, 'all' );
		return $this->render_reviews_shortcode( $atts );
	}

	/**
	 * CusRev-compatible reviews grid shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_cusrev_grid_shortcode( $atts = [] ): string {
		$atts = $this->normalize_shortcode_atts( $atts );
		$atts = $this->map_cusrev_args( $atts, 'grid' );
		return $this->render_reviews_shortcode( $atts );
	}

	/**
	 * CusRev-compatible reviews slider shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_cusrev_slider_shortcode( $atts = [] ): string {
		$atts = $this->normalize_shortcode_atts( $atts );
		$atts = $this->map_cusrev_args( $atts, 'slider' );
		return $this->render_slider_shortcode( $atts, null, 'cusrev_reviews_slider' );
	}

	/**
	 * Render a lightweight horizontal review slider.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @param string               $tag Shortcode tag.
	 * @return string
	 */
	public function render_slider_shortcode( $atts = [], $content = null, string $tag = 'overseek_review_slider' ): string {
		$atts           = $this->normalize_shortcode_atts( $atts );
		$args           = $this->normalize_shortcode_args( $atts, $tag );
		$args['layout'] = 'slider';
		$reviews        = $this->get_reviews( $args );
		if ( empty( $reviews ) && $this->is_block_editor_preview_request() ) {
			$reviews = $this->get_mock_reviews( $args );
		}
		$show_arrows    = $this->truthy( $args['slider_arrows'] ?? true );
		$show_dots      = $this->truthy( $args['slider_dots'] ?? false );
		$autoplay       = $this->truthy( $args['slider_autoplay'] ?? false );
		$data           = $autoplay ? ' data-os-review-slider data-os-review-autoplay="1"' : ' data-os-review-slider';
		$controls       = '';

		if ( $show_arrows ) {
			$controls .= '<div class="os-review-slider__arrows"><button type="button" class="os-review-slider__arrow" data-os-review-slider-prev aria-label="' . esc_attr__( 'Previous reviews', 'overseek-wc' ) . '">‹</button><button type="button" class="os-review-slider__arrow" data-os-review-slider-next aria-label="' . esc_attr__( 'Next reviews', 'overseek-wc' ) . '">›</button></div>';
		}

		if ( $show_dots && ! empty( $reviews ) ) {
			$controls .= '<div class="os-review-slider__dots" aria-hidden="true">' . str_repeat( '<span></span>', count( $reviews ) ) . '</div>';
		}

		return '<div class="os-reviews-shell os-reviews-shell--slider"' . $data . '>'
			. OverSeek_Review_Renderer::render_reviews( $reviews, $args )
			. $controls
			. '</div>';
	}

	/**
	 * CusRev-compatible rating shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_cusrev_rating_shortcode( $atts = [] ): string {
		return $this->render_review_stars_shortcode( $atts );
	}

	/**
	 * Render compact product review stars.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_review_stars_shortcode( $atts = [] ): string {
		$atts = $this->normalize_shortcode_atts( $atts );
		$atts = shortcode_atts(
			[
				'product'     => '',
				'product_id'  => '',
				'color_stars' => '',
				'show_count'  => 'true',
				'link'        => 'true',
			],
			$atts,
			'overseek_review_stars'
		);

		$product_id = ! empty( $atts['product'] ) ? absint( $atts['product'] ) : absint( $atts['product_id'] );
		if ( ! $product_id ) {
			$product_id = $this->get_current_product_id();
		}

		if ( ! $product_id ) {
			return '';
		}

		$summary = $this->get_summary( [ 'product_id' => $product_id, 'status' => 'approved' ] );
		$total   = isset( $summary['total'] ) ? (int) $summary['total'] : 0;
		$rating  = isset( $summary['average'] ) ? (float) $summary['average'] : 0.0;

		if ( $total <= 0 ) {
			return '';
		}

		$color = ! empty( $atts['color_stars'] ) ? sanitize_hex_color( (string) $atts['color_stars'] ) : '';
		$style = $color ? ' style="--os-review-star-color:' . esc_attr( $color ) . '"' : '';
		$full  = (int) floor( max( 0.0, min( 5.0, $rating ) ) );
		$stars = str_repeat( '★', $full ) . str_repeat( '☆', 5 - $full );
		$count = '';
		if ( $this->truthy( $atts['show_count'] ) ) {
			$count = sprintf(
				' <span class="os-review-stars-summary__count">%s</span>',
				esc_html( sprintf( _n( '(%d review)', '(%d reviews)', $total, 'overseek-wc' ), $total ) )
			);
		}
		$html  = '<span class="os-review-stars-summary"' . $style . '>'
			. '<span class="os-review-stars" aria-label="'
			. esc_attr( sprintf( 'Rated %.1f out of 5 from %d reviews', $rating, $total ) )
			. '">'
			. esc_html( $stars )
			. '</span>'
			. $count
			. '</span>';

		if ( $this->truthy( $atts['link'] ) ) {
			$html = '<a class="os-review-stars-summary__link" href="' . esc_url( get_permalink( $product_id ) . '#reviews' ) . '">'
				. $html
				. '</a>';
		}

		return $html;
	}

	/**
	 * CusRev-compatible email review button shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_cusrev_review_button_shortcode( $atts = [] ): string {
		$atts = $this->normalize_shortcode_atts( $atts );
		$atts = shortcode_atts( [ 'label' => 'Review', 'bg' => '#0073aa', 'color' => '#ffffff', 'radius' => '4px' ], $atts, 'cusrev_review_button' );
		$permalink = get_permalink( $this->get_current_product_id() );
		$url       = $permalink ? $permalink . '#review_form' : home_url( '/#review_form' );
		$style = sprintf( 'display:inline-block;background:%s;color:%s;border-radius:%s;padding:10px 16px;text-decoration:none;font-weight:700;', esc_attr( sanitize_hex_color( (string) $atts['bg'] ) ?: '#0073aa' ), esc_attr( sanitize_hex_color( (string) $atts['color'] ) ?: '#ffffff' ), esc_attr( sanitize_text_field( (string) $atts['radius'] ) ) );

		return '<a class="os-review-button" href="' . esc_url( $url ) . '" style="' . $style . '">' . esc_html( (string) $atts['label'] ) . '</a>';
	}

	/**
	 * CusRev Q&A compatibility placeholder.
	 *
	 * @return string
	 */
	public function render_cusrev_qna_shortcode(): string {
		return '<div class="os-reviews-empty">' . esc_html__( 'Questions and answers are not enabled yet.', 'overseek-wc' ) . '</div>';
	}

	/**
	 * Render reviews for the current or configured product.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_product_reviews_shortcode( $atts = [] ): string {
		$atts = $this->normalize_shortcode_atts( $atts );
		$args = $this->normalize_shortcode_args( $atts, 'overseek_product_reviews' );
		$args['product_reviews'] = 'true';
		$args['shop_reviews']    = 'false';
		if ( $this->is_review_request() ) {
			$args['add_review'] = '1';
		}
		$is_preview = $this->is_block_editor_preview_request();
		if ( empty( $args['product_id'] ) ) {
			$args['product_id'] = $this->get_current_product_id();
		}

		if ( empty( $args['product_id'] ) && ! $is_preview ) {
			return '<div class="os-reviews-empty">' . esc_html__( 'No product was found for these reviews.', 'overseek-wc' ) . '</div>';
		}

		$args['show_product'] = false;
		$reviews              = $this->get_reviews( $args );
		$summary              = $this->get_summary( $args );
		if ( empty( $reviews ) && $is_preview ) {
			$reviews = $this->get_mock_reviews( $args );
			$summary = $this->get_mock_summary();
		}
		$shell_id             = 'os-reviews-' . ++$this->shell_counter;
		$review_form          = $this->maybe_render_add_review_form( $args );
		if ( $is_preview && empty( $args['product_id'] ) && $this->truthy( $args['add_review'] ?? 'false' ) ) {
			$review_form = $this->render_mock_review_form( __( 'Write a review', 'overseek-wc' ) );
		}

		return '<div id="' . esc_attr( $shell_id ) . '" class="os-reviews-shell os-reviews-shell--product" data-os-reviews-shell>'
			. OverSeek_Review_Renderer::render_summary(
				$summary,
				[
					'product_only'    => true,
					'product_summary' => $summary,
					'store_name'      => get_bloginfo( 'name' ),
				]
			)
			. $this->render_schema_markup( $summary, $args )
			. OverSeek_Review_Renderer::render_reviews( $reviews, $args )
			. $this->render_pagination( $summary, $args )
			. $review_form
			. '</div>';
	}

	/**
	 * Render compact review rows.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_rows_shortcode( $atts = [] ): string {
		$atts    = $this->normalize_shortcode_atts( $atts );
		$args    = $this->normalize_shortcode_args( $atts, 'overseek_review_rows' );
		$reviews = $this->get_reviews( $args );
		if ( empty( $reviews ) && $this->is_block_editor_preview_request() ) {
			$reviews = $this->get_mock_reviews( $args );
		}

		return OverSeek_Review_Renderer::render_rows( $reviews, $args );
	}

	/**
	 * Render only the review summary.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_summary_shortcode( $atts = [] ): string {
		$atts = $this->normalize_shortcode_atts( $atts );
		$args = $this->normalize_shortcode_args( $atts, 'overseek_review_summary' );
		if ( empty( $args['product_id'] ) ) {
			$args['product_id'] = $this->get_current_product_id();
		}

		$summary = $this->get_summary( $args );
		if ( empty( $summary['total'] ) && $this->is_block_editor_preview_request() ) {
			$summary = $this->get_mock_summary();
		}

		return OverSeek_Review_Renderer::render_summary( $summary, $this->get_summary_context( $args, $summary ) );
	}

	/**
	 * Query native WooCommerce reviews.
	 *
	 * @param array<string, mixed> $args Query args.
	 * @return array<int, array<string, mixed>>
	 */
	public function get_reviews( array $args ): array {
		$query_args = $this->build_comment_query_args( $args );
		$comments   = get_comments( $query_args );
		$reviews    = [];

		foreach ( $comments as $comment ) {
			if ( ! ( $comment instanceof WP_Comment ) ) {
				continue;
			}

			$review = $this->map_comment_to_review( $comment );
			if ( ! empty( $args['min_chars'] ) && strlen( wp_strip_all_tags( (string) $review['content'] ) ) < (int) $args['min_chars'] ) {
				continue;
			}
			if ( $this->truthy( $args['only_media'] ?? false ) && empty( $review['media'] ) ) {
				continue;
			}
			if ( $this->truthy( $args['verified_only'] ?? false ) && empty( $review['verified'] ) ) {
				continue;
			}

			$reviews[] = $review;
		}

		if ( isset( $args['sort_by'] ) && 'media' === (string) $args['sort_by'] ) {
			usort(
				$reviews,
				static function ( array $a, array $b ) use ( $args ): int {
					$count_a = isset( $a['media'] ) && is_array( $a['media'] ) ? count( $a['media'] ) : 0;
					$count_b = isset( $b['media'] ) && is_array( $b['media'] ) ? count( $b['media'] ) : 0;
					return 'ASC' === ( $args['order'] ?? 'DESC' ) ? $count_a <=> $count_b : $count_b <=> $count_a;
				}
			);
		}

		return $reviews;
	}

	/**
	 * Get review summary for query args.
	 *
	 * @param array<string, mixed> $args Query args.
	 * @return array<string, mixed>
	 */
	public function get_summary( array $args ): array {
		$cache_key = 'overseek_review_summary_' . md5( wp_json_encode( $args ) ?: '' );
		$cached    = wp_cache_get( $cache_key, 'overseek_reviews' );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$summary_args           = $this->build_comment_query_args( $args );
		$summary_args['number'] = 0;
		$summary_args['offset'] = 0;
		$comments              = get_comments( $summary_args );
		$total                 = 0;
		$rating_total          = 0;

		foreach ( $comments as $comment ) {
			if ( ! ( $comment instanceof WP_Comment ) ) {
				continue;
			}

			if ( $this->truthy( $args['only_media'] ?? false ) || $this->truthy( $args['verified_only'] ?? false ) ) {
				$review = $this->map_comment_to_review( $comment );
				if ( $this->truthy( $args['only_media'] ?? false ) && empty( $review['media'] ) ) {
					continue;
				}
				if ( $this->truthy( $args['verified_only'] ?? false ) && empty( $review['verified'] ) ) {
					continue;
				}
			}

			$rating = (int) get_comment_meta( (int) $comment->comment_ID, 'rating', true );
			if ( $rating <= 0 ) {
				continue;
			}

			$total++;
			$rating_total += $rating;
		}

		$summary = [
			'total'   => $total,
			'average' => $total > 0 ? $rating_total / $total : 0,
		];

		wp_cache_set( $cache_key, $summary, 'overseek_reviews', 10 * MINUTE_IN_SECONDS );

		return $summary;
	}

	/**
	 * Build context for the review summary display.
	 *
	 * @param array<string, mixed> $args    Query args.
	 * @param array<string, mixed> $summary Current summary.
	 * @return array<string, mixed>
	 */
	private function get_summary_context( array $args, array $summary ): array {
		$product_id      = ! empty( $args['product_id'] ) ? (int) $args['product_id'] : 0;
		$product_summary = $summary;

		if ( $product_id > 0 ) {
			$store_args = $args;
			unset( $store_args['product_id'] );
			$product_summary = $summary;
			$summary         = $this->get_summary( $store_args );

			$product = function_exists( 'wc_get_product' ) ? wc_get_product( $product_id ) : null;
			if ( $product ) {
				$product_summary = [
					'total'   => $product->get_review_count(),
					'average' => (float) $product->get_average_rating(),
				];
			}
		} else {
			$product_args                    = $args;
			$product_args['review_source']   = 'product';
			$product_args['product_reviews'] = 'true';
			$product_args['shop_reviews']    = 'false';
			$product_summary                 = $this->get_summary( $product_args );
			if ( empty( $product_summary['total'] ) ) {
				$product_summary = $this->get_product_lookup_summary( $product_args );
			}
		}

		return [
			'store_name'      => get_bloginfo( 'name' ),
			'product_summary' => $product_summary,
			'store_summary'   => $summary,
		];
	}

	/**
	 * Get the aggregate WooCommerce product rating from product lookup data.
	 *
	 * @param array<string, mixed> $args Query args.
	 * @return array<string, mixed>
	 */
	private function get_product_lookup_summary( array $args ): array {
		global $wpdb;

		$lookup_table = $wpdb->prefix . 'wc_product_meta_lookup';
		$join         = '';
		$where        = 'WHERE lookup.rating_count > 0';

		if ( ! $this->truthy( $args['inactive_products'] ?? false ) ) {
			$join  = " INNER JOIN {$wpdb->posts} posts ON posts.ID = lookup.product_id";
			$where .= " AND posts.post_type = 'product' AND posts.post_status = 'publish'";
		}

		$row = $wpdb->get_row(
			"SELECT SUM(lookup.rating_count) AS total, SUM(lookup.average_rating * lookup.rating_count) AS rating_total FROM {$lookup_table} lookup{$join} {$where}",
			ARRAY_A
		);

		$total        = isset( $row['total'] ) ? (int) $row['total'] : 0;
		$rating_total = isset( $row['rating_total'] ) ? (float) $row['rating_total'] : 0.0;
		if ( $total <= 0 ) {
			$postmeta_summary = $this->get_product_postmeta_summary( $args );
			if ( ! empty( $postmeta_summary['total'] ) ) {
				return $postmeta_summary;
			}

			return $this->get_product_comment_summary( $args );
		}

		return [
			'total'   => $total,
			'average' => $total > 0 ? $rating_total / $total : 0,
		];
	}

	/**
	 * Get the aggregate product rating from WooCommerce product rating post meta.
	 *
	 * @param array<string, mixed> $args Query args.
	 * @return array<string, mixed>
	 */
	private function get_product_postmeta_summary( array $args ): array {
		global $wpdb;

		$where = "WHERE posts.post_type = 'product' AND count_meta.meta_key = '_wc_review_count' AND avg_meta.meta_key = '_wc_average_rating' AND CAST(count_meta.meta_value AS UNSIGNED) > 0";

		if ( ! $this->truthy( $args['inactive_products'] ?? false ) ) {
			$where .= " AND posts.post_status = 'publish'";
		}

		$row = $wpdb->get_row(
			"SELECT SUM(CAST(count_meta.meta_value AS UNSIGNED)) AS total, SUM(CAST(avg_meta.meta_value AS DECIMAL(10,4)) * CAST(count_meta.meta_value AS UNSIGNED)) AS rating_total FROM {$wpdb->posts} posts INNER JOIN {$wpdb->postmeta} count_meta ON count_meta.post_id = posts.ID INNER JOIN {$wpdb->postmeta} avg_meta ON avg_meta.post_id = posts.ID {$where}",
			ARRAY_A
		);

		$total        = isset( $row['total'] ) ? (int) $row['total'] : 0;
		$rating_total = isset( $row['rating_total'] ) ? (float) $row['rating_total'] : 0.0;

		return [
			'total'   => $total,
			'average' => $total > 0 ? $rating_total / $total : 0,
		];
	}

	/**
	 * Get the aggregate product rating from approved WooCommerce review comments.
	 *
	 * @param array<string, mixed> $args Query args.
	 * @return array<string, mixed>
	 */
	private function get_product_comment_summary( array $args ): array {
		global $wpdb;

		$join  = "INNER JOIN {$wpdb->posts} posts ON posts.ID = comments.comment_post_ID";
		$where = "WHERE comments.comment_approved = '1' AND posts.post_type = 'product'";

		if ( ! $this->truthy( $args['inactive_products'] ?? false ) ) {
			$where .= " AND posts.post_status = 'publish'";
		}

		$row = $wpdb->get_row(
			"SELECT COUNT(meta.meta_value) AS total, SUM(CAST(meta.meta_value AS DECIMAL(10,2))) AS rating_total FROM {$wpdb->comments} comments {$join} INNER JOIN {$wpdb->commentmeta} meta ON meta.comment_id = comments.comment_ID AND meta.meta_key = 'rating' {$where} AND CAST(meta.meta_value AS DECIMAL(10,2)) > 0",
			ARRAY_A
		);

		$total        = isset( $row['total'] ) ? (int) $row['total'] : 0;
		$rating_total = isset( $row['rating_total'] ) ? (float) $row['rating_total'] : 0.0;

		return [
			'total'   => $total,
			'average' => $total > 0 ? $rating_total / $total : 0,
		];
	}

	/**
	 * Determine whether a dynamic block is being rendered for the editor preview.
	 *
	 * @return bool
	 */
	private function is_block_editor_preview_request(): bool {
		if ( ! defined( 'REST_REQUEST' ) || ! REST_REQUEST ) {
			return false;
		}

		$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
		return false !== strpos( $request_uri, '/wp/v2/block-renderer/overseek/' ) || false !== strpos( $request_uri, '/wp/v2/block-renderer/overseek%2F' );
	}

	/**
	 * Return representative reviews for empty editor previews.
	 *
	 * @param array<string, mixed> $args Render args.
	 * @return array<int, array<string, mixed>>
	 */
	private function get_mock_reviews( array $args ): array {
		$reviews = [
			[
				'rating'       => 5,
				'reviewer'     => 'Sarah M.',
				'content'      => 'Beautiful quality and exactly what I hoped for. The order arrived quickly and the packaging made it feel really special.',
				'verified'     => true,
				'country'      => 'GB',
				'date'         => '2 days ago',
				'date_iso'     => gmdate( 'Y-m-d', strtotime( '-2 days' ) ),
				'product_name' => 'Sample Product',
				'product_url'  => '#',
				'replies'      => [
					[
						'author'  => get_bloginfo( 'name' ),
						'content' => 'Thank you for taking the time to leave such a kind review.',
					],
				],
			],
			[
				'rating'       => 5,
				'reviewer'     => 'James T.',
				'content'      => 'Really easy to order and the finished item looks excellent. I would happily buy from this store again.',
				'verified'     => true,
				'country'      => 'US',
				'date'         => '1 week ago',
				'date_iso'     => gmdate( 'Y-m-d', strtotime( '-1 week' ) ),
				'product_name' => 'Featured Product',
				'product_url'  => '#',
			],
			[
				'rating'       => 4,
				'reviewer'     => 'Emma R.',
				'content'      => 'Lovely product and helpful updates throughout. The review block preview uses sample content when your store has no reviews yet.',
				'verified'     => false,
				'country'      => 'AU',
				'date'         => '3 weeks ago',
				'date_iso'     => gmdate( 'Y-m-d', strtotime( '-3 weeks' ) ),
				'product_name' => 'New Arrival',
				'product_url'  => '#',
			],
		];

		$limit = isset( $args['limit'] ) ? max( 1, min( 3, (int) $args['limit'] ) ) : 3;
		return array_slice( $reviews, 0, $limit );
	}

	/**
	 * Return representative summary data for empty editor previews.
	 *
	 * @return array<string, mixed>
	 */
	private function get_mock_summary(): array {
		return [
			'total'   => 128,
			'average' => 4.8,
		];
	}

	/**
	 * Render a disabled sample review form for editor previews without a product.
	 *
	 * @param string $title Form title.
	 * @return string
	 */
	private function render_mock_review_form( string $title ): string {
		ob_start();
		?>
		<form class="os-review-form" aria-label="<?php echo esc_attr( $title ); ?>">
			<h3><?php echo esc_html( $title ); ?></h3>
			<fieldset class="os-review-form__field os-review-form__rating">
				<legend><?php esc_html_e( 'Rating', 'overseek-wc' ); ?></legend>
				<div class="os-review-form__stars" aria-hidden="true">
					<label>★</label><label>★</label><label>★</label><label>★</label><label>★</label>
				</div>
			</fieldset>
			<label class="os-review-form__field">
				<span><?php esc_html_e( 'Review', 'overseek-wc' ); ?></span>
				<textarea rows="5" disabled><?php esc_html_e( 'Sample review text appears here in the live form.', 'overseek-wc' ); ?></textarea>
			</label>
			<div class="os-review-form__grid">
				<label class="os-review-form__field"><span><?php esc_html_e( 'Name', 'overseek-wc' ); ?></span><input type="text" value="Alex Customer" disabled></label>
				<label class="os-review-form__field"><span><?php esc_html_e( 'Email', 'overseek-wc' ); ?></span><input type="email" value="alex@example.com" disabled></label>
			</div>
			<label class="os-review-form__field os-review-form__dropzone">
				<span><?php esc_html_e( 'Photos or videos', 'overseek-wc' ); ?></span>
				<strong><?php esc_html_e( 'Drag files here or click to upload', 'overseek-wc' ); ?></strong>
				<small><?php esc_html_e( 'Uploads are disabled in this editor preview.', 'overseek-wc' ); ?></small>
			</label>
			<button type="button" class="os-review-form__submit" disabled><?php esc_html_e( 'Submit review', 'overseek-wc' ); ?></button>
		</form>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Normalize attributes passed by WordPress shortcode callbacks.
	 *
	 * @param mixed $atts Raw shortcode attributes.
	 * @return array<string, mixed>
	 */
	private function normalize_shortcode_atts( $atts ): array {
		return is_array( $atts ) ? $atts : [];
	}

	/**
	 * Normalize shortcode attributes.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @param string               $tag  Shortcode tag.
	 * @return array<string, mixed>
	 */
	private function normalize_shortcode_args( array $atts, string $tag ): array {
		$attributes = shortcode_atts(
			[
				'product_id'   => 0,
				'limit'        => 12,
				'page'         => 1,
				'layout'       => 'grid',
				'columns'      => 3,
				'min_rating'   => 0,
				'review_source'=> 'product',
				'only_media'   => '0',
				'verified_only'=> '0',
				'show_media'   => '1',
				'show_product' => '1',
				'show_product_image' => '1',
				'show_reviewer' => '1',
				'show_country' => '1',
				'show_date'    => '1',
				'product_links'=> '1',
				'show_verified'=> '1',
				'show_replies' => '1',
				'avatars'      => 'initials',
				'max_chars'    => 0,
				'min_chars'    => 0,
				'products'     => '',
				'product_reviews' => 'true',
				'shop_reviews' => 'false',
				'inactive_products' => 'false',
				'categories'   => '',
				'product_tags' => '',
				'tags'         => '',
				'sort_by'      => 'date',
				'pagination'   => 'none',
				'add_review'   => 'false',
				'schema_markup'=> 'false',
				'color_brdr'   => '',
				'color_bcrd'   => '',
				'color_pr_bcrd'=> '',
				'color_stars'  => '',
				'card_style'   => 'comfortable',
				'radius'       => 28,
				'shadow'       => 2,
				'slider_desktop' => 3,
				'slider_mobile' => 1,
				'slider_autoplay' => '0',
				'slider_arrows' => '1',
				'slider_dots'   => '0',
				'status'       => 'approved',
				'order'        => 'DESC',
				'class'        => '',
			],
			$atts,
			$tag
		);

		$attributes['product_id'] = absint( $attributes['product_id'] );
		$attributes['limit']      = max( 1, min( 100, absint( $attributes['limit'] ) ) );
		$attributes['page']       = max( 1, absint( $attributes['page'] ) );
		$attributes['columns']    = max( 1, min( 4, absint( $attributes['columns'] ) ) );
		$attributes['min_rating'] = max( 0, min( 5, absint( $attributes['min_rating'] ) ) );
		$attributes['max_chars']  = max( 0, absint( $attributes['max_chars'] ) );
		$attributes['min_chars']  = max( 0, absint( $attributes['min_chars'] ) );
		$attributes['radius']     = max( 8, min( 40, absint( $attributes['radius'] ) ) );
		$attributes['shadow']     = max( 0, min( 3, absint( $attributes['shadow'] ) ) );
		$attributes['slider_desktop'] = max( 1, min( 5, absint( $attributes['slider_desktop'] ) ) );
		$attributes['slider_mobile']  = max( 1, min( 2, absint( $attributes['slider_mobile'] ) ) );
		$attributes['layout']     = in_array( sanitize_key( (string) $attributes['layout'] ), [ 'grid', 'list', 'slider' ], true ) ? sanitize_key( (string) $attributes['layout'] ) : 'grid';
		$attributes['pagination'] = in_array( sanitize_key( (string) $attributes['pagination'] ), [ 'none', 'pages', 'load_more', 'infinite' ], true ) ? sanitize_key( (string) $attributes['pagination'] ) : 'none';
		$attributes['card_style'] = in_array( sanitize_key( (string) $attributes['card_style'] ), [ 'compact', 'comfortable', 'feature' ], true ) ? sanitize_key( (string) $attributes['card_style'] ) : 'comfortable';
		$attributes['review_source'] = in_array( sanitize_key( (string) $attributes['review_source'] ), [ 'product', 'shop', 'both' ], true ) ? sanitize_key( (string) $attributes['review_source'] ) : 'product';
		$order = strtoupper( (string) $attributes['order'] );
		$attributes['order']      = in_array( $order, [ 'ASC', 'DESC', 'RAND' ], true ) ? $order : 'DESC';
		$attributes['status']     = sanitize_key( (string) $attributes['status'] );
		$this->normalize_sort_args( $attributes );
		$attributes['avatars']    = sanitize_key( (string) $attributes['avatars'] );
		if ( 'shop' === $attributes['review_source'] ) {
			$attributes['product_reviews'] = 'false';
			$attributes['shop_reviews']    = 'true';
		} elseif ( 'both' === $attributes['review_source'] ) {
			$attributes['product_reviews'] = 'true';
			$attributes['shop_reviews']    = 'true';
		}
		$attributes['product_reviews'] = $this->truthy( $attributes['product_reviews'] ) ? 'true' : 'false';
		$attributes['shop_reviews']    = $this->truthy( $attributes['shop_reviews'] ) ? 'true' : 'false';
		$attributes['inactive_products'] = $this->truthy( $attributes['inactive_products'] ) ? 'true' : 'false';

		if ( isset( $_GET['os_reviews_page'] ) ) {
			$attributes['page'] = max( 1, absint( wp_unslash( $_GET['os_reviews_page'] ) ) );
		}

		return $attributes;
	}

	/**
	 * Normalize friendly sort labels into query args.
	 *
	 * @param array<string, mixed> $attributes Attributes by reference.
	 * @return void
	 */
	private function normalize_sort_args( array &$attributes ): void {
		$sort_by = sanitize_key( (string) $attributes['sort_by'] );
		if ( 'date_asc' === $sort_by ) {
			$attributes['sort_by'] = 'date';
			$attributes['order']   = 'ASC';
			return;
		}
		if ( 'date_desc' === $sort_by ) {
			$attributes['sort_by'] = 'date';
			$attributes['order']   = 'DESC';
			return;
		}
		if ( 'rating_asc' === $sort_by ) {
			$attributes['sort_by'] = 'rating';
			$attributes['order']   = 'ASC';
			return;
		}
		if ( 'rating_desc' === $sort_by ) {
			$attributes['sort_by'] = 'rating';
			$attributes['order']   = 'DESC';
			return;
		}
		if ( 'random' === $sort_by ) {
			$attributes['sort_by'] = 'date';
			$attributes['order']   = 'RAND';
			return;
		}

		$attributes['sort_by'] = in_array( $sort_by, [ 'date', 'rating', 'media' ], true ) ? $sort_by : 'date';
	}

	/**
	 * Map CusRev shortcode attributes to OverSeek renderer attributes.
	 *
	 * @param array<string, mixed> $atts CusRev attrs.
	 * @param string               $mode Compatibility mode.
	 * @return array<string, mixed>
	 */
	private function map_cusrev_args( array $atts, string $mode ): array {
		$mapped = $atts;
		if ( isset( $atts['per_page'] ) ) {
			$mapped['limit'] = $atts['per_page'];
		}
		if ( isset( $atts['count'] ) ) {
			$mapped['limit'] = $atts['count'];
		}
		if ( isset( $atts['show_summary_bar'] ) ) {
			$mapped['show_summary_bar'] = $this->truthy( $atts['show_summary_bar'] ) ? '1' : '0';
		}
		if ( isset( $atts['show_products'] ) ) {
			$mapped['show_product'] = $this->truthy( $atts['show_products'] ) ? '1' : '0';
		}
		if ( isset( $atts['show_media'] ) ) {
			$mapped['show_media'] = $this->truthy( $atts['show_media'] ) ? '1' : '0';
		}
		if ( isset( $atts['show_replies'] ) ) {
			$mapped['show_replies'] = $this->truthy( $atts['show_replies'] ) ? '1' : '0';
		}
		if ( isset( $atts['product_links'] ) ) {
			$mapped['product_links'] = $this->truthy( $atts['product_links'] ) ? '1' : '0';
		}
		if ( isset( $atts['product_reviews'] ) ) {
			$mapped['product_reviews'] = $this->truthy( $atts['product_reviews'] ) ? 'true' : 'false';
		}
		if ( isset( $atts['shop_reviews'] ) ) {
			$mapped['shop_reviews'] = $this->truthy( $atts['shop_reviews'] ) ? 'true' : 'false';
		}
		if ( isset( $atts['inactive_products'] ) ) {
			$mapped['inactive_products'] = $this->truthy( $atts['inactive_products'] ) ? 'true' : 'false';
		}
		if ( isset( $atts['show_more'] ) && absint( $atts['show_more'] ) > 0 ) {
			$mapped['pagination'] = 'load_more';
			$mapped['limit'] = absint( $atts['show_more'] );
		}
		if ( 'grid' === $mode ) {
			$mapped['layout'] = 'grid';
			$mapped['columns'] = 3;
			$mapped['show_summary_bar'] = $this->truthy( $atts['show_summary_bar'] ?? 'false' ) ? '1' : '0';
		}
		if ( 'slider' === $mode ) {
			$mapped['layout'] = 'slider';
			$mapped['limit'] = $atts['count'] ?? 5;
		}

		return $mapped;
	}

	/**
	 * Render an optional review form after a reviews shortcode.
	 *
	 * @param array<string, mixed> $args Args.
	 * @return string
	 */
	private function maybe_render_add_review_form( array $args ): string {
		$value = $args['add_review'] ?? 'false';
		if ( ! $this->truthy( $value ) && ! absint( $value ) ) {
			return '';
		}

		$product_id = absint( $value ) ?: ( ! empty( $args['product_id'] ) ? (int) $args['product_id'] : $this->get_current_product_id() );
		if ( ! $product_id && $this->truthy( $args['shop_reviews'] ?? false ) ) {
			return do_shortcode( '[overseek_review_form shop_review="true"]' );
		}

		if ( ! $product_id ) {
			return '';
		}

		return do_shortcode( '[overseek_review_form product_id="' . absint( $product_id ) . '"]' );
	}

	/**
	 * Determine whether the current page was opened from a review-request email.
	 *
	 * @return bool
	 */
	private function is_review_request(): bool {
		return ! empty( $_GET['overseek_review_request'] ) || ! empty( $_GET['overseek_review_rating'] );
	}

	/**
	 * Render AggregateRating schema for single-product review displays.
	 *
	 * @param array<string, mixed> $summary Summary data.
	 * @param array<string, mixed> $args Args.
	 * @return string
	 */
	private function render_schema_markup( array $summary, array $args ): string {
		if ( ! $this->truthy( $args['schema_markup'] ?? false ) || empty( $args['product_id'] ) || empty( $summary['total'] ) ) {
			return '';
		}

		$product = function_exists( 'wc_get_product' ) ? wc_get_product( (int) $args['product_id'] ) : null;
		$data = [
			'@context' => 'https://schema.org',
			'@type' => 'Product',
			'name' => $product ? $product->get_name() : get_the_title( (int) $args['product_id'] ),
			'aggregateRating' => [
				'@type' => 'AggregateRating',
				'ratingValue' => number_format( (float) $summary['average'], 1, '.', '' ),
				'reviewCount' => (int) $summary['total'],
			],
		];

		return '<script type="application/ld+json">' . wp_json_encode( $data ) . '</script>';
	}

	/**
	 * Build WP comment query args from normalized args.
	 *
	 * @param array<string, mixed> $args Args.
	 * @return array<string, mixed>
	 */
	private function build_comment_query_args( array $args ): array {
		$limit  = isset( $args['limit'] ) ? (int) $args['limit'] : 12;
		$page   = isset( $args['page'] ) ? (int) $args['page'] : 1;
		$status = $this->map_status( isset( $args['status'] ) ? (string) $args['status'] : 'approved' );

		$product_reviews = $this->truthy( $args['product_reviews'] ?? true );
		$shop_reviews    = $this->truthy( $args['shop_reviews'] ?? false );
		$post_types       = [];
		if ( $product_reviews ) {
			$post_types[] = 'product';
		}
		if ( $shop_reviews ) {
			$post_types[] = 'page';
		}

		$query_args = [
			'post_type' => ! empty( $post_types ) ? array_values( array_unique( $post_types ) ) : 'product',
			'type'      => 'review',
			'status'    => $status,
			'number'    => $limit,
			'offset'    => ( $page - 1 ) * $limit,
			'orderby'   => $this->map_orderby( $args ),
			'order'     => isset( $args['order'] ) && 'ASC' === $args['order'] ? 'ASC' : 'DESC',
		];

		if ( isset( $args['order'] ) && 'RAND' === $args['order'] ) {
			$query_args['orderby'] = 'rand';
		}

		if ( $shop_reviews && ! $product_reviews ) {
			$query_args['post_id'] = $this->get_shop_review_post_id();
		}

		if ( ! empty( $args['product_id'] ) ) {
			$query_args['post_id'] = (int) $args['product_id'];
		} elseif ( ! empty( $args['products'] ) ) {
			$products = $this->parse_ids( (string) $args['products'] );
			if ( ! empty( $products ) ) {
				$query_args['post__in'] = $products;
			} elseif ( 'current' === (string) $args['products'] && $this->get_current_product_id() ) {
				$query_args['post_id'] = $this->get_current_product_id();
			}
		}

		$post_ids = $this->get_filtered_product_ids( $args );
		if ( ! empty( $post_ids ) ) {
			$query_args['post__in'] = isset( $query_args['post__in'] ) ? array_values( array_intersect( (array) $query_args['post__in'], $post_ids ) ) : $post_ids;
		}

		if ( ! $this->truthy( $args['inactive_products'] ?? false ) && $product_reviews && ! $shop_reviews ) {
			$query_args['post_status'] = 'publish';
		}

		if ( ! empty( $args['min_rating'] ) ) {
			$query_args['meta_query'] = [
				[
					'key'     => 'rating',
					'value'   => (int) $args['min_rating'],
					'compare' => '>=',
					'type'    => 'NUMERIC',
				],
			];
		}

		if ( isset( $args['sort_by'] ) && 'rating' === (string) $args['sort_by'] ) {
			$query_args['meta_key'] = 'rating';
		}

		return $query_args;
	}

	/**
	 * Resolve review accent colours from admin settings or WooCommerce brand colour.
	 *
	 * @return array{primary: string, secondary: string, tertiary: string}
	 */
	private function get_review_brand_colors(): array {
		$woocommerce_brand = sanitize_hex_color( (string) get_option( 'woocommerce_email_base_color', '#f59e0b' ) ) ?: '#f59e0b';
		$primary           = sanitize_hex_color( (string) get_option( 'overseek_reviews_accent_primary', '' ) ) ?: $woocommerce_brand;
		$secondary         = sanitize_hex_color( (string) get_option( 'overseek_reviews_accent_secondary', '' ) ) ?: $primary;
		$tertiary          = sanitize_hex_color( (string) get_option( 'overseek_reviews_accent_tertiary', '' ) ) ?: $primary;

		return [
			'primary'   => $primary,
			'secondary' => $secondary,
			'tertiary'  => $tertiary,
		];
	}

	/**
	 * Normalize boolean-like values.
	 *
	 * @param mixed $value Value.
	 * @return bool
	 */
	private function truthy( $value ): bool {
		if ( is_bool( $value ) ) {
			return $value;
		}

		return ! in_array( strtolower( (string) $value ), [ '0', 'false', 'no', 'off', '' ], true );
	}

	/**
	 * Map sort_by values to comment query orderby.
	 *
	 * @param array<string, mixed> $args Args.
	 * @return string
	 */
	private function map_orderby( array $args ): string {
		$sort_by = isset( $args['sort_by'] ) ? (string) $args['sort_by'] : 'date';
		if ( 'rating' === $sort_by ) {
			return 'meta_value_num';
		}
		return 'comment_date_gmt';
	}

	/**
	 * Parse comma-separated IDs.
	 *
	 * @param string $raw Raw IDs.
	 * @return array<int, int>
	 */
	private function parse_ids( string $raw ): array {
		return array_values( array_filter( array_map( 'absint', preg_split( '/\s*,\s*/', $raw ) ?: [] ) ) );
	}

	/**
	 * Get product IDs matching category/tag filters.
	 *
	 * @param array<string, mixed> $args Args.
	 * @return array<int, int>
	 */
	private function get_filtered_product_ids( array $args ): array {
		$tax_query = [];
		if ( ! empty( $args['categories'] ) ) {
			$tax_query[] = [ 'taxonomy' => 'product_cat', 'field' => 'term_id', 'terms' => $this->parse_ids( (string) $args['categories'] ) ];
		}
		if ( ! empty( $args['product_tags'] ) ) {
			$tax_query[] = [ 'taxonomy' => 'product_tag', 'field' => 'slug', 'terms' => array_filter( array_map( 'sanitize_title', preg_split( '/\s*,\s*/', (string) $args['product_tags'] ) ?: [] ) ) ];
		}
		if ( empty( $tax_query ) ) {
			return [];
		}

		$ids = get_posts( [ 'post_type' => 'product', 'fields' => 'ids', 'posts_per_page' => -1, 'tax_query' => $tax_query ] );
		return array_map( 'absint', $ids );
	}

	/**
	 * Map shortcode status names to WordPress comment status values.
	 *
	 * @param string $status Status value.
	 * @return string
	 */
	private function map_status( string $status ): string {
		$map = [
			'approved' => 'approve',
			'approve'  => 'approve',
			'hold'     => 'hold',
			'pending'  => 'hold',
			'spam'     => 'spam',
			'trash'    => 'trash',
			'all'      => 'all',
		];

		return $map[ $status ] ?? 'approve';
	}

	/**
	 * Convert a WordPress comment into renderer data.
	 *
	 * @param WP_Comment $comment Review comment.
	 * @return array<string, mixed>
	 */
	private function map_comment_to_review( WP_Comment $comment ): array {
		$product  = function_exists( 'wc_get_product' ) ? wc_get_product( (int) $comment->comment_post_ID ) : null;
		$rating   = (int) get_comment_meta( (int) $comment->comment_ID, 'rating', true );
		$image_id = $product ? (int) $product->get_image_id() : 0;
		$image    = $image_id > 0 ? wp_get_attachment_image_url( $image_id, 'thumbnail' ) : '';
		$is_shop_review = ! $product || 'product' !== get_post_type( (int) $comment->comment_post_ID );

		return [
			'id'           => (int) $comment->comment_ID,
			'product_id'   => (int) $comment->comment_post_ID,
			'product_name' => $is_shop_review ? __( 'Shop review', 'overseek-wc' ) : $product->get_name(),
			'product_url'  => $is_shop_review ? home_url( '/' ) : $product->get_permalink(),
			'product_image' => $image ? (string) $image : '',
			'reviewer'     => $comment->comment_author ?: __( 'Customer', 'overseek-wc' ),
			'rating'       => $rating,
			'content'      => $comment->comment_content,
			'date'         => mysql2date( get_option( 'date_format' ), $comment->comment_date ),
			'date_iso'     => mysql2date( 'c', $comment->comment_date_gmt ),
			'verified'     => $this->is_verified_review( (int) $comment->comment_ID ),
			'country'      => $this->get_review_country( $comment ),
			'replies'      => $this->get_review_replies( (int) $comment->comment_ID ),
			'media'        => $this->get_review_media( (int) $comment->comment_ID ),
		];
	}

	/**
	 * Render basic pagination controls.
	 *
	 * @param array<string, mixed> $summary Summary data.
	 * @param array<string, mixed> $args Render args.
	 * @return string
	 */
	private function render_pagination( array $summary, array $args ): string {
		$mode = isset( $args['pagination'] ) ? (string) $args['pagination'] : 'none';
		if ( 'none' === $mode ) {
			return '';
		}

		$total = isset( $summary['total'] ) ? (int) $summary['total'] : 0;
		$limit = isset( $args['limit'] ) ? max( 1, (int) $args['limit'] ) : 12;
		$page  = isset( $args['page'] ) ? max( 1, (int) $args['page'] ) : 1;
		$pages = (int) ceil( $total / $limit );

		if ( $pages <= 1 ) {
			return '';
		}

		if ( in_array( $mode, [ 'load_more', 'infinite' ], true ) && $page < $pages ) {
			$url = esc_url( add_query_arg( 'os_reviews_page', $page + 1 ) );
			$label = 'infinite' === $mode ? __( 'Load next reviews', 'overseek-wc' ) : __( 'Load more reviews', 'overseek-wc' );
			return '<div class="os-reviews-pagination os-reviews-pagination--' . esc_attr( $mode ) . '"><a class="os-reviews-pagination__button" href="' . $url . '">' . esc_html( $label ) . '</a></div>';
		}

		$out = '<nav class="os-reviews-pagination" aria-label="' . esc_attr__( 'Review pages', 'overseek-wc' ) . '">';
		for ( $i = 1; $i <= $pages; $i++ ) {
			$out .= '<a class="os-reviews-pagination__page' . ( $i === $page ? ' is-active' : '' ) . '" href="' . esc_url( add_query_arg( 'os_reviews_page', $i ) ) . '">' . esc_html( (string) $i ) . '</a>';
		}
		return $out . '</nav>';
	}

	/**
	 * Get approved merchant replies for a review.
	 *
	 * @param int $comment_id Review comment ID.
	 * @return array<int, array<string, string>>
	 */
	private function get_review_replies( int $comment_id ): array {
		$children = get_comments( [ 'parent' => $comment_id, 'status' => 'approve', 'order' => 'ASC' ] );
		$out = [];

		foreach ( $children as $reply ) {
			if ( ! ( $reply instanceof WP_Comment ) || '' === trim( (string) $reply->comment_content ) ) {
				continue;
			}

			$out[] = [
				'author'  => (string) $reply->comment_author,
				'content' => (string) $reply->comment_content,
			];
		}

		return $out;
	}

	/**
	 * Resolve a review country code from known metadata.
	 *
	 * @param WP_Comment $comment Review comment.
	 * @return string
	 */
	private function get_review_country( WP_Comment $comment ): string {
		$comment_id = (int) $comment->comment_ID;
		foreach ( [ 'overseek_country', 'review_country', 'country', 'billing_country' ] as $key ) {
			$value = strtoupper( substr( sanitize_text_field( (string) get_comment_meta( $comment_id, $key, true ) ), 0, 2 ) );
			if ( 2 === strlen( $value ) ) {
				return $value;
			}
		}

		return '';
	}

	/**
	 * Resolve media attached to a review through comment meta.
	 *
	 * @param int $comment_id Comment ID.
	 * @return array<int, array<string, string>>
	 */
	private function get_review_media( int $comment_id ): array {
		$raw_ids = get_comment_meta( $comment_id, 'overseek_media_ids', true );
		if ( empty( $raw_ids ) ) {
			$raw_ids = get_comment_meta( $comment_id, 'ivole_review_image', true );
		}

		$ids = is_array( $raw_ids ) ? $raw_ids : array_filter( array_map( 'absint', explode( ',', (string) $raw_ids ) ) );
		$out = [];

		foreach ( $ids as $id ) {
			$attachment_id = absint( $id );
			$url           = wp_get_attachment_url( $attachment_id );
			if ( ! $url ) {
				continue;
			}

			$out[] = [
				'id'   => (string) $attachment_id,
				'url'  => $url,
				'type' => (string) get_post_mime_type( $attachment_id ),
			];
		}

		return $out;
	}

	/**
	 * Determine verified-owner state using WooCommerce if available.
	 *
	 * @param int $comment_id Comment ID.
	 * @return bool
	 */
	private function is_verified_review( int $comment_id ): bool {
		if ( function_exists( 'wc_review_is_from_verified_owner' ) ) {
			return (bool) wc_review_is_from_verified_owner( $comment_id );
		}

		return (bool) get_comment_meta( $comment_id, 'verified', true );
	}

	/**
	 * Get the current product ID in product contexts.
	 *
	 * @return int
	 */
	private function get_current_product_id(): int {
		global $product;

		if ( $product instanceof WC_Product ) {
			return (int) $product->get_id();
		}

		$post_id = get_the_ID();
		return $post_id ? (int) $post_id : 0;
	}

	/**
	 * Get the post used as the native comment bucket for shop reviews.
	 *
	 * @return int
	 */
	private function get_shop_review_post_id(): int {
		if ( function_exists( 'wc_get_page_id' ) ) {
			$shop_id = (int) wc_get_page_id( 'shop' );
			if ( $shop_id > 0 ) {
				return $shop_id;
			}
		}

		$front_id = (int) get_option( 'page_on_front' );
		return $front_id > 0 ? $front_id : 1;
	}
}
