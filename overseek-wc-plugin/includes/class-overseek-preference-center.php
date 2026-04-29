<?php
/**
 * Customer email preference center rendered on the WooCommerce storefront.
 *
 * @package OverSeek
 * @since   2.15.0
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OverSeek_Preference_Center {
	/**
	 * Nonce action used for preference updates.
	 *
	 * @var string
	 */
	private string $nonce_action = 'overseek_preference_update';

	/**
	 * Nonce field name used in the preference form.
	 *
	 * @var string
	 */
	private string $nonce_name = 'overseek_preference_nonce';

	/**
	 * OverSeek API base URL.
	 *
	 * @var string
	 */
	private string $api_url;

	/**
	 * Query-string key used to open the hosted preference center.
	 *
	 * @var string
	 */
	private string $query_key = 'overseek_email_preferences';

	/**
	 * Shortcode tag.
	 *
	 * @var string
	 */
	private string $shortcode_tag = 'overseek_preference_center';

	public function __construct() {
		$this->api_url = untrailingslashit( (string) get_option( 'overseek_api_url', '' ) );

		add_action( 'template_redirect', [ $this, 'maybe_render_preference_center' ] );
		add_action( 'init', [ $this, 'register_shortcode' ] );
		add_action( 'init', [ $this, 'register_block' ] );
		add_action( 'wp_enqueue_scripts', [ $this, 'maybe_enqueue_public_assets' ] );
	}

	/**
	 * Register the storefront stylesheet used by the preference center.
	 *
	 * @return void
	 */
	public function maybe_enqueue_public_assets(): void {
		if ( isset( $_GET[ $this->query_key ] ) ) {
			$this->enqueue_public_assets();
			return;
		}

		$post = get_queried_object();
		if ( ! ( $post instanceof WP_Post ) ) {
			return;
		}

		$content = (string) $post->post_content;
		$has_shortcode = has_shortcode( $content, $this->shortcode_tag );
		$has_block_match = function_exists( 'has_block' ) && has_block( 'overseek/preference-center', $post );

		if ( $has_shortcode || $has_block_match ) {
			$this->enqueue_public_assets();
		}
	}

	/**
	 * Enqueue the registered stylesheet handle.
	 *
	 * @return void
	 */
	private function enqueue_public_assets(): void {
		wp_enqueue_style(
			'overseek-preference-center',
			OVERSEEK_WC_PLUGIN_URL . 'assets/preference-center.css',
			array(),
			OVERSEEK_WC_VERSION
		);
	}

	/**
	 * Register the customer-facing shortcode.
	 *
	 * @return void
	 */
	public function register_shortcode(): void {
		add_shortcode( $this->shortcode_tag, [ $this, 'render_shortcode' ] );
	}

	/**
	 * Register a dynamic Gutenberg block for the preference center.
	 *
	 * @return void
	 */
	public function register_block(): void {
		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}

		$block_dir = OVERSEEK_WC_PLUGIN_DIR . 'blocks/preference-center';
		if ( ! file_exists( $block_dir . '/block.json' ) ) {
			return;
		}

		register_block_type(
			$block_dir,
			[
				'render_callback' => [ $this, 'render_block' ],
			]
		);
	}

	/**
	 * Intercepts preference-center requests and renders a lightweight page on the store domain.
	 *
	 * @return void
	 */
	public function maybe_render_preference_center(): void {
		if ( ! isset( $_GET[ $this->query_key ] ) ) {
			return;
		}

		$token = OverSeek_Preference_Center_Request::get_request_token( $this->query_key );

		if ( empty( $token ) ) {
			$this->render_standalone_page(
				[
					'title'   => 'Invalid Link',
					'message' => 'This email preferences link is invalid or incomplete.',
					'status'  => 400,
				]
			);
		}

		if ( empty( $this->api_url ) ) {
			$this->render_standalone_page(
				[
					'title'   => 'Unavailable',
					'message' => 'This store is not connected to OverSeek right now, so email preferences cannot be updated here.',
					'status'  => 503,
				]
			);
		}

		if ( OverSeek_Preference_Center_Request::current_request_uses_embedded_preference_center( $this->shortcode_tag ) ) {
			return;
		}

		$embedded_page_url = OverSeek_Preference_Center_Request::find_embedded_preference_center_page_url( $this->shortcode_tag );
		if ( $embedded_page_url ) {
			wp_safe_redirect( add_query_arg( $this->query_key, rawurlencode( $token ), $embedded_page_url ) );
			exit;
		}

		$state = $this->resolve_state_for_request( $token );
		$this->render_standalone_page( $state );
	}

	/**
	 * Render the shortcode on a normal WordPress page.
	 *
	 * @param array<string, mixed> $atts Shortcode attributes.
	 * @return string
	 */
	public function render_shortcode( array $atts = [] ): string {
		$attributes = shortcode_atts(
			[
				'title' => 'Email Preferences',
			],
			$atts,
			$this->shortcode_tag
		);

		return $this->render_embedded_markup( $attributes );
	}

	/**
	 * Render callback for the dynamic block.
	 *
	 * @param array<string, mixed> $attributes Block attributes.
	 * @return string
	 */
	public function render_block( array $attributes = [] ): string {
		return $this->render_embedded_markup( $attributes );
	}

	/**
	 * Shared embedded rendering path for shortcode and block usage.
	 *
	 * @param array<string, mixed> $attributes Render attributes.
	 * @return string
	 */
	private function render_embedded_markup( array $attributes = [] ): string {
		$token = OverSeek_Preference_Center_Request::get_request_token( $this->query_key );

		if ( empty( $token ) ) {
			return $this->build_markup(
				[
					'title'   => isset( $attributes['title'] ) ? (string) $attributes['title'] : 'Email Preferences',
					'message' => 'Add the email preference token to the page URL to let customers manage their subscription choices here.',
					'status'  => 200,
				],
				true
			);
		}

		if ( empty( $this->api_url ) ) {
			return $this->build_markup(
				[
					'title'   => 'Unavailable',
					'message' => 'This store is not connected to OverSeek right now, so email preferences cannot be updated here.',
					'status'  => 503,
				],
				true
			);
		}

		return $this->build_markup( $this->resolve_state_for_request( $token ), true );
	}

	/**
	 * Resolve the current view/update state based on the incoming request.
	 *
	 * @param string $token Preference token from the email log tracking id.
	 * @return array<string, mixed>
	 */
	private function resolve_state_for_request( string $token ): array {
		$is_post = 'POST' === strtoupper( $_SERVER['REQUEST_METHOD'] ?? '' );
		$scope   = isset( $_POST['scope'] ) ? sanitize_text_field( wp_unslash( $_POST['scope'] ) ) : 'MARKETING';

		return OverSeek_Preference_Center_State::resolve(
			$this->api_url,
			$token,
			$is_post,
			OverSeek_Preference_Center_Request::is_valid_submission( $this->nonce_name, $this->nonce_action ),
			$scope
		);
	}

	/**
	 * Render the standalone token page response.
	 *
	 * @param array<string, mixed> $state Page rendering state.
	 * @return void
	 */
	private function render_standalone_page( array $state ): void {
		$status = isset( $state['status'] ) ? (int) $state['status'] : 200;

		nocache_headers();
		status_header( $status );

		echo '<!DOCTYPE html><html ' . get_language_attributes() . '><head>';
		echo '<meta charset="' . esc_attr( get_bloginfo( 'charset' ) ) . '">';
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
		echo '<title>' . esc_html( isset( $state['title'] ) ? (string) $state['title'] : 'Email Preferences' ) . '</title>';
		echo '<link rel="stylesheet" href="' . esc_url( OVERSEEK_WC_PLUGIN_URL . 'assets/preference-center.css?ver=' . OVERSEEK_WC_VERSION ) . '">';
		echo '</head><body>';
		echo $this->build_markup( $state, false ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		echo '</body></html>';
		exit;
	}

	/**
	 * Build the preference-center markup for either standalone or embedded usage.
	 *
	 * @param array<string, mixed> $state Page rendering state.
	 * @param bool                 $embedded Whether the markup is being embedded in the page content.
	 * @return string
	 */
	private function build_markup( array $state, bool $embedded ): string {
		$title         = isset( $state['title'] ) ? (string) $state['title'] : 'Email Preferences';
		$message       = isset( $state['message'] ) ? (string) $state['message'] : '';
		$email         = isset( $state['email'] ) ? (string) $state['email'] : '';
		$account_name  = isset( $state['accountName'] ) ? (string) $state['accountName'] : 'this sender';
		$current_scope = isset( $state['currentScope'] ) ? (string) $state['currentScope'] : 'NONE';
		$token         = isset( $state['token'] ) ? (string) $state['token'] : '';
		$is_success    = ! empty( $state['isSuccess'] );

		$scope_message = 'You are currently subscribed to email updates.';
		if ( 'MARKETING' === $current_scope ) {
			$scope_message = 'Marketing email is currently turned off for this address.';
		} elseif ( 'ALL' === $current_scope ) {
			$scope_message = 'All email is currently turned off for this address.';
		}

		$success_message = '';
		if ( $is_success ) {
			$success_message = 'ALL' === $current_scope
				? 'You have been unsubscribed from all future email from this sender.'
				: 'You have been unsubscribed from future marketing email.';
		}

		$base_url    = get_permalink();
		$fallback_url = home_url( '/' );
		$action_url  = $base_url ? $base_url : $fallback_url;
		$form_action = esc_url( add_query_arg( $this->query_key, rawurlencode( $token ), $action_url ) );
		$wrapper_class = $embedded ? ' os-pref-wrap--embedded' : '';
		$status_badge  = $message ? 'Issue' : ( $is_success ? 'Updated' : 'Manage preferences' );
		$status_class  = $message ? 'os-pref-badge--error' : ( $is_success ? 'os-pref-badge--success' : 'os-pref-badge--neutral' );
		$marketing_active = 'MARKETING' !== $current_scope && 'ALL' !== $current_scope;
		$all_active       = 'ALL' === $current_scope;

		ob_start();
		?>
		<div class="os-pref-shell<?php echo esc_attr( $embedded ? ' is-embedded' : '' ); ?>">
			<div class="os-pref-wrap<?php echo esc_attr( $wrapper_class ); ?>">
				<div class="os-pref-card">
					<div class="os-pref-card__hero">
						<div>
							<div class="os-pref-kicker">OverSeek Preferences</div>
							<h1><?php echo esc_html( $title ); ?></h1>
							<p class="os-pref-subtitle">Review what lands in your inbox and make a one-click update to this sender's email permissions.</p>
						</div>
						<span class="os-pref-badge <?php echo esc_attr( $status_class ); ?>"><?php echo esc_html( $status_badge ); ?></span>
					</div>

					<?php if ( $message ) : ?>
						<div class="os-pref-banner os-pref-banner--error"><?php echo esc_html( $message ); ?></div>
					<?php elseif ( $is_success ) : ?>
						<div class="os-pref-banner os-pref-banner--success"><?php echo esc_html( $success_message ); ?></div>
						<div class="os-pref-summary-grid">
							<div class="os-pref-summary-card">
								<span class="os-pref-summary-label">Updated address</span>
								<strong><?php echo esc_html( $email ?: 'This recipient' ); ?></strong>
							</div>
							<div class="os-pref-summary-card">
								<span class="os-pref-summary-label">Current status</span>
								<strong><?php echo esc_html( 'ALL' === $current_scope ? 'All email blocked' : 'Marketing blocked' ); ?></strong>
							</div>
						</div>
						<p class="os-pref-note">Your preference was saved successfully. You can close this window now.</p>
					<?php else : ?>
						<div class="os-pref-summary-grid">
							<div class="os-pref-summary-card">
								<span class="os-pref-summary-label">Email address</span>
								<strong class="os-pref-email"><?php echo esc_html( $email ); ?></strong>
							</div>
							<div class="os-pref-summary-card">
								<span class="os-pref-summary-label">Sender</span>
								<strong><?php echo esc_html( $account_name ); ?></strong>
							</div>
						</div>

						<p>Choose whether to stop marketing emails only, or stop all email from this sender.</p>
						<div class="os-pref-note"><?php echo esc_html( $scope_message ); ?></div>
						<form method="post" action="<?php echo esc_url( $form_action ); ?>" class="os-pref-actions">
							<?php wp_nonce_field( $this->nonce_action, $this->nonce_name ); ?>
							<button type="submit" class="os-pref-option <?php echo $marketing_active ? 'is-active' : ''; ?>" name="scope" value="MARKETING">
								<span class="os-pref-option__title">Unsubscribe from marketing</span>
								<span class="os-pref-option__copy">Keep transactional updates like receipts and essential order messaging.</span>
							</button>
							<button type="submit" class="os-pref-option os-pref-option--all <?php echo $all_active ? 'is-active' : ''; ?>" name="scope" value="ALL">
								<span class="os-pref-option__title">Unsubscribe from all email</span>
								<span class="os-pref-option__copy">Stop marketing, campaigns, and non-essential follow-up from this sender entirely.</span>
							</button>
						</form>
						<p class="os-pref-footnote">Order receipts and other important updates can continue if you only opt out of marketing.</p>
					<?php endif; ?>
				</div>
			</div>
		</div>
		<?php
		return (string) ob_get_clean();
	}

}
