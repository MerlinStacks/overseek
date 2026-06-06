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
	private const MAX_BYTES    = 26214400;

	/**
	 * Initialize hooks.
	 */
	public function __construct() {
		add_shortcode( 'overseek_review_form', [ $this, 'render_shortcode' ] );
		add_action( 'admin_post_overseek_submit_review', [ $this, 'handle_submission' ] );
		add_action( 'admin_post_nopriv_overseek_submit_review', [ $this, 'handle_submission' ] );
		add_filter( 'woocommerce_product_tabs', [ $this, 'maybe_replace_reviews_tab' ], 30 );
	}

	/**
	 * Render the review form shortcode.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_shortcode( array $atts = [] ): string {
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
		if ( ! get_option( 'overseek_reviews_replace_form', '' ) ) {
			return $tabs;
		}

		if ( isset( $tabs['reviews'] ) ) {
			$tabs['reviews']['callback'] = [ $this, 'render_product_reviews_tab' ];
		}

		return $tabs;
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

		echo do_shortcode( '[overseek_product_reviews product_id="' . absint( $product_id ) . '"]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo $this->render_form( $product_id, __( 'Write a review', 'overseek-wc' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	/**
	 * Handle frontend review submissions.
	 *
	 * @return void
	 */
	public function handle_submission(): void {
		$product_id  = isset( $_POST['product_id'] ) ? absint( $_POST['product_id'] ) : 0;
		$shop_review = ! empty( $_POST['shop_review'] );
		$redirect    = $shop_review ? home_url( '/' ) : ( $product_id ? get_permalink( $product_id ) : home_url( '/' ) );

		if ( ! isset( $_POST[ self::NONCE_NAME ] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST[ self::NONCE_NAME ] ) ), self::NONCE_ACTION ) ) {
			$this->redirect_with_status( $redirect, 'invalid' );
		}

		$product      = ! $shop_review && $product_id ? wc_get_product( $product_id ) : null;
		$product_type = $product_id ? get_post_type( $product_id ) : '';
		if ( $shop_review ) {
			$product_id = $this->get_shop_review_post_id();
		} elseif ( ! $product || ! in_array( $product_type, [ 'product', 'product_variation' ], true ) || ! comments_open( $product_id ) ) {
			$this->redirect_with_status( $redirect, 'invalid-product' );
		}

		$rating  = isset( $_POST['rating'] ) ? absint( $_POST['rating'] ) : 0;
		$content = isset( $_POST['review'] ) ? trim( sanitize_textarea_field( wp_unslash( $_POST['review'] ) ) ) : '';
		$name    = isset( $_POST['author'] ) ? sanitize_text_field( wp_unslash( $_POST['author'] ) ) : '';
		$email   = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';

		if ( $rating < 1 || $rating > 5 || '' === $content || '' === $name || ! is_email( $email ) ) {
			$this->redirect_with_status( $redirect, 'missing' );
		}

		$has_media = $this->has_uploaded_media();
		$approved  = $has_media || get_option( 'comment_moderation' ) ? 0 : 1;

		$comment_id = wp_new_comment(
			[
				'comment_post_ID'      => $product_id,
				'comment_author'       => $name,
				'comment_author_email' => $email,
				'comment_content'      => $content,
				'comment_type'         => 'review',
				'comment_approved'     => $approved,
				'comment_meta'         => [
					'rating'               => $rating,
					'overseek_shop_review' => $shop_review ? '1' : '0',
				],
			]
		);

		if ( ! $comment_id || is_wp_error( $comment_id ) ) {
			$this->redirect_with_status( $redirect, 'failed' );
		}

		$media_ids = $this->handle_media_uploads( $product_id );
		if ( ! empty( $media_ids ) ) {
			update_comment_meta( (int) $comment_id, 'overseek_media_ids', $media_ids );
			wp_set_comment_status( (int) $comment_id, 'hold' );
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
		if ( ! $product_id || ( ! $shop_review && ! comments_open( $product_id ) ) ) {
			return '';
		}

		$prefilled_rating = isset( $_GET['overseek_review_rating'] ) ? absint( wp_unslash( $_GET['overseek_review_rating'] ) ) : 0;
		if ( $prefilled_rating < 1 || $prefilled_rating > 5 ) {
			$prefilled_rating = 0;
		}

		ob_start();
		?>
		<?php echo $this->render_submission_notice(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
		<form id="review_form" class="os-review-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data">
			<h3><?php echo esc_html( $title ); ?></h3>
			<input type="hidden" name="action" value="overseek_submit_review">
			<input type="hidden" name="product_id" value="<?php echo esc_attr( (string) $product_id ); ?>">
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
					<input type="text" name="author" autocomplete="name" required>
				</label>

				<label class="os-review-form__field">
					<span><?php esc_html_e( 'Email', 'overseek-wc' ); ?></span>
					<input type="email" name="email" autocomplete="email" required>
				</label>
			</div>

			<label class="os-review-form__field os-review-form__dropzone">
				<span><?php esc_html_e( 'Photos or videos', 'overseek-wc' ); ?></span>
				<strong><?php esc_html_e( 'Drag files here or click to upload', 'overseek-wc' ); ?></strong>
				<input type="file" name="os_review_media[]" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" multiple>
				<small><?php echo esc_html( sprintf( __( 'Upload up to %1$d files, up to %2$s each. Reviews with media are held for moderation.', 'overseek-wc' ), self::MAX_FILES, size_format( $this->max_upload_bytes() ) ) ); ?></small>
			</label>

			<button type="submit" class="os-review-form__submit"><?php esc_html_e( 'Submit review', 'overseek-wc' ); ?></button>
		</form>
		<?php
		return (string) ob_get_clean();
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

		return '<div class="os-review-form__notice os-review-form__notice--error">' . esc_html__( 'We could not submit your review. Please check the form and try again.', 'overseek-wc' ) . '</div>';
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
	 * @param string $url    Redirect URL.
	 * @param string $status Status slug.
	 * @return void
	 */
	private function redirect_with_status( string $url, string $status ): void {
		$redirect = add_query_arg( 'overseek_review_status', rawurlencode( $status ), $url );
		wp_safe_redirect( esc_url_raw( $redirect . '#reviews' ) );
		exit;
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
