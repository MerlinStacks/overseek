<?php
/**
 * Custom native WooCommerce review form.
 *
 * @package OverSeek
 * @since   2.17.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Handles review form rendering, submission, and optional product tab replacement.
 */
class OverSeek_Review_Form {
	private const NONCE_ACTION = 'overseek_submit_review';
	private const NONCE_NAME   = 'overseek_review_nonce';
	private const MAX_FILES    = 6;
	private const MAX_BYTES    = 10485760;
	private const RATE_LIMIT_MAX = 5;
	private const RATE_LIMIT_WINDOW = HOUR_IN_SECONDS;

	/**
	 * Track forms already rendered during the request to avoid duplicate fallbacks.
	 *
	 * @var array<string, bool>
	 */
	private array $rendered_forms = [];

	/**
	 * Initialize hooks.
	 */
	public function __construct() {
		add_shortcode( 'overseek_review_form', [ $this, 'render_shortcode' ] );
		add_action( 'admin_post_overseek_submit_review', [ $this, 'handle_submission' ] );
		add_action( 'admin_post_nopriv_overseek_submit_review', [ $this, 'handle_submission' ] );
		add_action( 'template_redirect', [ $this, 'disable_cache_for_review_requests' ], 0 );
		add_action( 'woocommerce_after_single_product_summary', [ $this, 'render_review_request_fallback' ], 11 );
		add_filter( 'woocommerce_product_tabs', [ $this, 'maybe_replace_reviews_tab' ], 999 );
		add_filter( 'comments_template', [ $this, 'maybe_replace_product_comments_template' ], 20 );
	}

	/**
	 * Review-request URLs must render a fresh page so the direct form is available.
	 *
	 * @return void
	 */
	public function disable_cache_for_review_requests(): void {
		if ( empty( $_GET['overseek_review_request'] ) && empty( $_GET['overseek_review_rating'] ) ) {
			return;
		}

		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}

		if ( function_exists( 'do_action' ) ) {
			do_action( 'litespeed_control_set_nocache', 'OverSeek review request' );
		}

		nocache_headers();
	}

	/**
	 * Render the review form shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_shortcode( $atts = [] ): string {
		$atts = is_array( $atts ) ? $atts : [];
		$attributes = shortcode_atts(
			[
				'product_id' => 0,
				'shop_review' => 'false',
				'title'      => __( 'Write a review', 'overseek-wc' ),
			],
			$atts,
			'overseek_review_form'
		);

		$shop_review = $this->truthy( $attributes['shop_review'] ?? false );
		$product_id  = $shop_review ? $this->get_shop_review_post_id() : absint( $attributes['product_id'] );
		if ( ! $product_id ) {
			$product_id = $this->get_current_product_id();
		}

		return $this->render_form( $product_id, (string) $attributes['title'], $shop_review );
	}

	/**
	 * Replace WooCommerce's reviews tab content when enabled.
	 *
	 * @param array<string, mixed> $tabs Product tabs.
	 * @return array<string, mixed>
	 */
	public function maybe_replace_reviews_tab( array $tabs ): array {
		if ( ! $this->should_replace_product_reviews() ) {
			return $tabs;
		}

		if ( isset( $tabs['reviews'] ) ) {
			$tabs['reviews']['callback'] = [ $this, 'render_product_reviews_tab' ];
		}

		return $tabs;
	}

	/**
	 * Replace product comments template when a theme renders reviews directly.
	 *
	 * @param string $template Current comments template path.
	 * @return string
	 */
	public function maybe_replace_product_comments_template( string $template ): string {
		if ( ! $this->should_replace_product_reviews() || ! $this->is_product_comments_template_request() ) {
			return $template;
		}

		$overseek_template = OVERSEEK_WC_PLUGIN_DIR . 'templates/product-reviews.php';
		return file_exists( $overseek_template ) ? $overseek_template : $template;
	}

	/**
	 * Render replacement product reviews tab.
	 *
	 * @param string $key Tab key.
	 * @param array<string, mixed> $tab Tab config.
	 * @return void
	 */
	public function render_product_reviews_tab( string $key = '', array $tab = [] ): void {
		$product_id = $this->get_current_product_id();
		if ( ! $product_id ) {
			return;
		}

		echo do_shortcode( '[overseek_product_reviews product_id="' . absint( $product_id ) . '" limit="12" pagination="load_more" show_media="1" add_review="1"]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	/**
	 * Render a direct form when the theme does not expose one.
	 *
	 * @return void
	 */
	public function render_review_request_fallback(): void {
		if ( ! ( function_exists( 'is_product' ) && is_product() ) ) {
			return;
		}

		$product_id = $this->get_current_product_id();
		$key        = $this->get_rendered_form_key( $product_id, false );
		if ( ! $product_id || ! empty( $this->rendered_forms[ $key ] ) ) {
			return;
		}

		$form = $this->render_form( $product_id, __( 'Write a review', 'overseek-wc' ), false );
		if ( '' === $form ) {
			return;
		}

		echo '<section class="os-review-request-fallback">' . $form . '</section>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	/**
	 * Check if product review replacement is enabled.
	 *
	 * @return bool
	 */
	private function should_replace_product_reviews(): bool {
		return '1' === (string) get_option( 'overseek_reviews_replace_form', '' );
	}

	/**
	 * Check if the current comments template belongs to a WooCommerce product page.
	 *
	 * @return bool
	 */
	private function is_product_comments_template_request(): bool {
		if ( function_exists( 'is_product' ) && is_product() ) {
			return true;
		}

		$post_id = get_the_ID();
		return $post_id > 0 && 'product' === get_post_type( $post_id );
	}

	/**
	 * Handle frontend review submissions.
	 *
	 * @return void
	 */
	public function handle_submission(): void {
		$product_id  = isset( $_POST['product_id'] ) ? absint( $_POST['product_id'] ) : 0;
		$shop_review = ! empty( $_POST['shop_review'] );
		$redirect    = $this->get_submitted_redirect_url( $shop_review ? home_url( '/' ) : $this->get_review_redirect_url( $product_id ) );

		$nonce = isset( $_POST[ self::NONCE_NAME ] ) ? sanitize_text_field( wp_unslash( $_POST[ self::NONCE_NAME ] ) ) : '';
		if ( '' === $nonce || ! wp_verify_nonce( $nonce, self::NONCE_ACTION ) ) {
			$this->redirect_with_status( $redirect, 'invalid-nonce' );
		}

		if ( ! $this->passes_spam_checks() ) {
			$this->redirect_with_status( $redirect, 'spam-check' );
		}

		if ( ! $shop_review ) {
			$product_id = $this->resolve_product_id( $product_id, $redirect );
		}

		if ( ! $shop_review ) {
			$product_id = $this->normalize_product_review_id( $product_id );
		}

		$product      = ! $shop_review && $product_id ? wc_get_product( $product_id ) : null;
		$product_type = $product_id ? get_post_type( $product_id ) : '';
		if ( $shop_review ) {
			$product_id = $this->get_shop_review_post_id();
		} elseif ( ! $product || 'product' !== $product_type ) {
			$this->redirect_with_status( $redirect, 'invalid-product' );
		}

		$rating  = isset( $_POST['rating'] ) ? absint( $_POST['rating'] ) : 0;
		$content = isset( $_POST['review'] ) ? trim( sanitize_textarea_field( wp_unslash( $_POST['review'] ) ) ) : '';
		$name    = isset( $_POST['author'] ) ? sanitize_text_field( wp_unslash( $_POST['author'] ) ) : '';
		$email   = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';

		if ( $rating < 1 || $rating > 5 || '' === $content || '' === $name || ! is_email( $email ) ) {
			$this->redirect_with_status( $redirect, 'missing' );
		}

		if ( ! $this->passes_rate_limit( $email ) ) {
			$this->redirect_with_status( $redirect, 'rate-limited' );
		}

		if ( ! $shop_review && ! $this->product_review_submission_allowed( $product_id, $email ) ) {
			$this->redirect_with_status( $redirect, 'not-allowed' );
		}

		$comment_id = wp_insert_comment(
			[
				'comment_post_ID'      => $product_id,
				'comment_author'       => $name,
				'comment_author_email' => $email,
				'comment_content'      => $content,
				'comment_type'         => 'review',
				'comment_approved'     => 0,
				'comment_author_IP'    => isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '',
				'comment_agent'        => isset( $_SERVER['HTTP_USER_AGENT'] ) ? substr( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ), 0, 254 ) : '',
				'comment_date'         => current_time( 'mysql' ),
				'comment_date_gmt'     => current_time( 'mysql', true ),
			]
		);

		if ( ! $comment_id || is_wp_error( $comment_id ) ) {
			$this->redirect_with_status( $redirect, 'failed' );
		}

		add_comment_meta( (int) $comment_id, 'rating', $rating, true );
		add_comment_meta( (int) $comment_id, 'overseek_shop_review', $shop_review ? '1' : '0', true );

		$media_ids = $this->handle_media_uploads( $product_id );
		if ( ! empty( $media_ids ) ) {
			update_comment_meta( (int) $comment_id, 'overseek_media_ids', $media_ids );
		}

		$this->redirect_with_status( $redirect, 'submitted' );
	}

	/**
	 * Render review form markup.
	 *
	 * @param int    $product_id Product ID.
	 * @param string $title Form title.
	 * @return string
	 */
	private function render_form( int $product_id, string $title, bool $shop_review = false ): string {
		if ( ! $product_id ) {
			return '';
		}

		if ( ! $shop_review ) {
			$product_id = $this->normalize_product_review_id( $product_id );
			if ( ! $product_id || ! $this->product_review_form_allowed( $product_id ) ) {
				return '';
			}
		}

		$this->rendered_forms[ $this->get_rendered_form_key( $product_id, $shop_review ) ] = true;

		$prefilled_rating = isset( $_GET['overseek_review_rating'] ) ? absint( wp_unslash( $_GET['overseek_review_rating'] ) ) : 0;
		if ( $prefilled_rating < 1 || $prefilled_rating > 5 ) {
			$prefilled_rating = 0;
		}
		$prefilled_name  = isset( $_GET['overseek_review_name'] ) ? sanitize_text_field( wp_unslash( $_GET['overseek_review_name'] ) ) : '';
		$prefilled_email = isset( $_GET['overseek_review_email'] ) ? sanitize_email( wp_unslash( $_GET['overseek_review_email'] ) ) : '';

		ob_start();
		?>
		<?php echo $this->render_submission_notice(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
		<form id="review_form" class="os-review-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
			<h3><?php echo esc_html( $title ); ?></h3>
			<input type="hidden" name="action" value="overseek_submit_review">
			<input type="hidden" name="product_id" value="<?php echo esc_attr( (string) $product_id ); ?>">
			<input type="hidden" name="redirect_to" value="<?php echo esc_url( $this->get_current_request_url() ); ?>">
			<input type="hidden" name="rendered_at" value="<?php echo esc_attr( (string) time() ); ?>">
			<input type="text" name="overseek_review_contact_url" value="" tabindex="-1" autocomplete="off" class="os-review-form__website" aria-hidden="true" readonly>
			<?php if ( $shop_review ) : ?>
				<input type="hidden" name="shop_review" value="1">
			<?php endif; ?>
			<?php wp_nonce_field( self::NONCE_ACTION, self::NONCE_NAME ); ?>

			<fieldset class="os-review-form__field os-review-form__rating">
				<legend><?php esc_html_e( 'Rating', 'overseek-wc' ); ?></legend>
				<div class="os-review-form__stars" aria-label="<?php esc_attr_e( 'Choose a rating', 'overseek-wc' ); ?>">
					<?php for ( $star = 5; $star >= 1; $star-- ) : ?>
						<input id="os-review-rating-<?php echo esc_attr( (string) $star ); ?>" type="radio" name="rating" value="<?php echo esc_attr( (string) $star ); ?>" <?php checked( $prefilled_rating, $star ); ?> required>
						<label for="os-review-rating-<?php echo esc_attr( (string) $star ); ?>" aria-label="<?php echo esc_attr( sprintf( _n( '%d star', '%d stars', $star, 'overseek-wc' ), $star ) ); ?>">★</label>
					<?php endfor; ?>
				</div>
			</fieldset>

			<label class="os-review-form__field">
				<span><?php esc_html_e( 'Review', 'overseek-wc' ); ?></span>
				<textarea name="review" rows="5" required></textarea>
			</label>

			<div class="os-review-form__grid">
				<label class="os-review-form__field">
					<span><?php esc_html_e( 'Name', 'overseek-wc' ); ?></span>
					<input type="text" name="author" value="<?php echo esc_attr( $prefilled_name ); ?>" autocomplete="name" required>
				</label>

				<label class="os-review-form__field">
					<span><?php esc_html_e( 'Email', 'overseek-wc' ); ?></span>
					<input type="email" name="email" value="<?php echo esc_attr( $prefilled_email ); ?>" autocomplete="email" required>
				</label>
			</div>

			<label class="os-review-form__field os-review-form__dropzone">
				<span><?php esc_html_e( 'Photos or videos', 'overseek-wc' ); ?></span>
				<strong><?php esc_html_e( 'Drag files here or click to upload', 'overseek-wc' ); ?></strong>
				<input type="file" name="os_review_media[]" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" multiple>
				<small><?php echo esc_html( sprintf( __( 'Upload up to %1$d files, up to %2$s each. Reviews are held for moderation.', 'overseek-wc' ), self::MAX_FILES, size_format( $this->max_upload_bytes() ) ) ); ?></small>
			</label>

			<button type="submit" class="os-review-form__submit"><?php esc_html_e( 'Submit review', 'overseek-wc' ); ?></button>
		</form>
		<?php
		return (string) ob_get_clean();
	}

	/**
	 * Build a stable rendered-form key.
	 *
	 * @param int  $product_id  Product ID.
	 * @param bool $shop_review Whether this is a shop review form.
	 * @return string
	 */
	private function get_rendered_form_key( int $product_id, bool $shop_review ): string {
		return ( $shop_review ? 'shop' : 'product' ) . ':' . absint( $product_id );
	}

	/**
	 * Render submission feedback after redirects.
	 *
	 * @return string
	 */
	private function render_submission_notice(): string {
		if ( empty( $_GET['overseek_review_status'] ) ) {
			return '';
		}

		$status = sanitize_key( wp_unslash( $_GET['overseek_review_status'] ) );
		if ( 'submitted' === $status ) {
			return '<div class="os-review-form__notice os-review-form__notice--success">' . esc_html__( 'Thanks. Your review has been submitted and may be held briefly for moderation.', 'overseek-wc' ) . '</div>';
		}

		$messages = [
			'invalid-nonce'   => __( 'Your review form expired. Please refresh the page and try again.', 'overseek-wc' ),
			'invalid-product' => __( 'We could not match this review to the product. Please refresh the page and try again.', 'overseek-wc' ),
			'missing'         => __( 'Please complete the rating, review, name, and email fields.', 'overseek-wc' ),
			'not-allowed'     => __( 'Reviews are not available for this product right now.', 'overseek-wc' ),
			'rate-limited'    => __( 'Please wait before submitting another review.', 'overseek-wc' ),
			'spam-check'      => __( 'We could not submit your review. Please refresh the page and try again.', 'overseek-wc' ),
			'failed'          => __( 'WordPress could not save this review. Please try again.', 'overseek-wc' ),
		];

		return '<div class="os-review-form__notice os-review-form__notice--error">' . esc_html( $messages[ $status ] ?? __( 'We could not submit your review. Please check the form and try again.', 'overseek-wc' ) ) . '</div>';
	}

	/**
	 * Check whether submitted request contains media.
	 *
	 * @return bool
	 */
	private function has_uploaded_media(): bool {
		return isset( $_FILES['os_review_media']['name'] ) && is_array( $_FILES['os_review_media']['name'] ) && ! empty( array_filter( $_FILES['os_review_media']['name'] ) );
	}

	/**
	 * Apply lightweight bot checks before creating a review.
	 *
	 * @return bool
	 */
	private function passes_spam_checks(): bool {
		if ( ! empty( $_POST['overseek_review_contact_url'] ) ) {
			return false;
		}

		$rendered_at = isset( $_POST['rendered_at'] ) ? absint( $_POST['rendered_at'] ) : 0;
		return ! $rendered_at || $rendered_at <= time();
	}

	private function passes_rate_limit( string $email ): bool {
		$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$key = 'os_review_rate_' . substr( hash( 'sha256', strtolower( $email ) . '|' . $ip ), 0, 20 );
		$count = (int) get_transient( $key );

		if ( $count >= self::RATE_LIMIT_MAX ) {
			return false;
		}

		set_transient( $key, $count + 1, self::RATE_LIMIT_WINDOW );
		return true;
	}

	private function product_review_form_allowed( int $product_id ): bool {
		if ( $product_id <= 0 || 'product' !== get_post_type( $product_id ) ) {
			return false;
		}

		return ! function_exists( 'wc_get_product' ) || false !== wc_get_product( $product_id );
	}

	private function product_review_submission_allowed( int $product_id, string $email ): bool {
		if ( ! $this->product_review_form_allowed( $product_id ) ) {
			return false;
		}

		if ( 'yes' !== (string) get_option( 'woocommerce_review_rating_verification_required', 'no' ) ) {
			return true;
		}

		return function_exists( 'wc_customer_bought_product' ) && wc_customer_bought_product( $email, get_current_user_id(), $product_id );
	}

	/**
	 * Store uploaded review media as WordPress attachments.
	 *
	 * @param int $product_id Product ID.
	 * @return array<int, int>
	 */
	private function handle_media_uploads( int $product_id ): array {
		if ( ! $this->has_uploaded_media() ) {
			return [];
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$files = $_FILES['os_review_media'];
		$ids   = [];
		$count = min( self::MAX_FILES, count( $files['name'] ) );

		for ( $index = 0; $index < $count; $index++ ) {
			if ( empty( $files['name'][ $index ] ) || ! empty( $files['error'][ $index ] ) || (int) $files['size'][ $index ] > $this->max_upload_bytes() ) {
				continue;
			}

			$file = [
				'name'     => sanitize_file_name( (string) $files['name'][ $index ] ),
				'type'     => (string) $files['type'][ $index ],
				'tmp_name' => (string) $files['tmp_name'][ $index ],
				'error'    => (int) $files['error'][ $index ],
				'size'     => (int) $files['size'][ $index ],
			];

			$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], $this->allowed_mimes() );
			if ( empty( $check['type'] ) ) {
				continue;
			}

			$upload = wp_handle_upload( $file, [ 'test_form' => false, 'mimes' => $this->allowed_mimes() ] );
			if ( isset( $upload['error'] ) || empty( $upload['file'] ) ) {
				continue;
			}

			$attachment_id = wp_insert_attachment(
				[
					'post_mime_type' => (string) $upload['type'],
					'post_title'     => sanitize_file_name( pathinfo( (string) $upload['file'], PATHINFO_FILENAME ) ),
					'post_content'   => '',
					'post_status'    => 'inherit',
				],
				(string) $upload['file'],
				$product_id
			);

			if ( ! $attachment_id || is_wp_error( $attachment_id ) ) {
				continue;
			}

			$metadata = wp_generate_attachment_metadata( (int) $attachment_id, (string) $upload['file'] );
			if ( ! empty( $metadata ) ) {
				wp_update_attachment_metadata( (int) $attachment_id, $metadata );
			}

			$ids[] = (int) $attachment_id;
		}

		return $ids;
	}

	/**
	 * Allowed media MIME types.
	 *
	 * @return array<string, string>
	 */
	private function allowed_mimes(): array {
		return [
			'jpg|jpeg' => 'image/jpeg',
			'png'      => 'image/png',
			'webp'     => 'image/webp',
			'gif'      => 'image/gif',
			'mp4'      => 'video/mp4',
			'mov'      => 'video/quicktime',
			'webm'     => 'video/webm',
		];
	}

	/**
	 * Redirect back to product with a status flag.
	 *
	 * @param mixed  $url    Redirect URL.
	 * @param string $status Status slug.
	 * @return void
	 */
	private function redirect_with_status( $url, string $status ): void {
		$url      = is_string( $url ) && '' !== $url ? $url : home_url( '/' );
		$redirect = add_query_arg( 'overseek_review_status', rawurlencode( $status ), $url );
		wp_safe_redirect( esc_url_raw( $redirect . '#review_form' ) );
		exit;
	}

	/**
	 * Resolve the product from the submitted ID or originating product URL.
	 *
	 * @param int    $product_id Submitted product ID.
	 * @param string $redirect   Same-page redirect URL.
	 * @return int
	 */
	private function resolve_product_id( int $product_id, string $redirect ): int {
		if ( $product_id && wc_get_product( $product_id ) && in_array( get_post_type( $product_id ), [ 'product', 'product_variation' ], true ) ) {
			return $this->normalize_product_review_id( $product_id );
		}

		$path = wp_parse_url( $redirect, PHP_URL_PATH );
		if ( ! is_string( $path ) || '' === $path ) {
			return $product_id;
		}

		$scheme = wp_parse_url( home_url(), PHP_URL_SCHEME );
		$host   = wp_parse_url( home_url(), PHP_URL_HOST );
		$url    = ( is_string( $scheme ) ? $scheme : 'https' ) . '://' . ( is_string( $host ) ? $host : '' ) . $path;
		$post_id = url_to_postid( $url );

		if ( $post_id && wc_get_product( $post_id ) && in_array( get_post_type( $post_id ), [ 'product', 'product_variation' ], true ) ) {
			return $this->normalize_product_review_id( (int) $post_id );
		}

		return $product_id;
	}

	private function normalize_product_review_id( int $product_id ): int {
		$product = $product_id > 0 ? wc_get_product( $product_id ) : null;
		if ( ! $product ) {
			return 0;
		}

		if ( 'product_variation' === get_post_type( $product_id ) && method_exists( $product, 'get_parent_id' ) ) {
			$parent_id = (int) $product->get_parent_id();
			return $parent_id > 0 ? $parent_id : 0;
		}

		return 'product' === get_post_type( $product_id ) ? $product_id : 0;
	}

	/**
	 * Get the submitted same-page redirect URL, falling back to a product URL.
	 *
	 * @param string $fallback Fallback redirect URL.
	 * @return string
	 */
	private function get_submitted_redirect_url( string $fallback ): string {
		$url = '';
		if ( ! empty( $_POST['redirect_to'] ) ) {
			$url = esc_url_raw( wp_unslash( $_POST['redirect_to'] ) );
		}

		if ( '' === $url ) {
			$referer = wp_get_referer();
			$url     = is_string( $referer ) ? $referer : '';
		}

		$url = wp_validate_redirect( $url, $fallback );

		return remove_query_arg( 'overseek_review_status', $url );
	}

	/**
	 * Get the current request URL for post-submit redirects.
	 *
	 * @return string
	 */
	private function get_current_request_url(): string {
		$scheme      = is_ssl() ? 'https' : 'http';
		$home_host   = wp_parse_url( home_url(), PHP_URL_HOST );
		$host        = isset( $_SERVER['HTTP_HOST'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) ) : ( is_string( $home_host ) ? $home_host : '' );
		$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
		$url         = wp_validate_redirect( esc_url_raw( $scheme . '://' . $host . $request_uri ), home_url( '/' ) );

		return remove_query_arg( 'overseek_review_status', $url );
	}

	/**
	 * Get a safe redirect URL for review submissions.
	 *
	 * @param int $product_id Product ID.
	 * @return string
	 */
	private function get_review_redirect_url( int $product_id ): string {
		if ( $product_id ) {
			$permalink = get_permalink( $product_id );
			if ( is_string( $permalink ) && '' !== $permalink ) {
				return $permalink;
			}
		}

		return home_url( '/' );
	}

	/**
	 * Maximum accepted upload size, capped by PHP/WordPress upload settings.
	 *
	 * @return int
	 */
	private function max_upload_bytes(): int {
		return min( self::MAX_BYTES, (int) wp_max_upload_size() );
	}

	/**
	 * Get current product ID.
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
	 * Normalize boolean-like shortcode values.
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
