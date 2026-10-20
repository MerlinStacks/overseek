<?php
/** Regression coverage for empty ratings and product/store separation. */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ );
define( 'OVERSEEK_WC_PLUGIN_DIR', dirname( __DIR__ ) . '/' );
define( 'OVERSEEK_WC_PLUGIN_URL', 'https://store.test/plugins/overseek/' );
function esc_attr( $value ) { return htmlspecialchars( (string) $value, ENT_QUOTES ); }
function esc_html( $value ) { return esc_attr( $value ); }
function __( $value, $domain = '' ) { return $value; }
function esc_attr__( $value, $domain = '' ) { return esc_attr( $value ); }
function esc_html__( $value, $domain = '' ) { return esc_html( $value ); }
function esc_html_e( $value, $domain = '' ) { echo esc_html( $value ); }
function _n( $single, $plural, $count, $domain = '' ) { return 1 === $count ? $single : $plural; }
function number_format_i18n( $value, $decimals = 0 ) { return number_format( $value, $decimals ); }
function get_bloginfo( $key ) { return 'Fixture store'; }
function absint( $value ) { return abs( (int) $value ); }
function shortcode_atts( $defaults, $atts, $tag = '' ) { return array_merge( $defaults, array_intersect_key( $atts, $defaults ) ); }
function get_permalink( $id ) { return 'https://store.test/product/' . $id; }
function esc_url( $value ) { return esc_attr( $value ); }
function get_option( $key, $default = false ) { return $default; }
function sanitize_hex_color( $value ) { return preg_match( '/^#[a-f0-9]{6}$/i', $value ) ? $value : null; }
function sanitize_key( $value ) { return preg_replace( '/[^a-z0-9_-]/', '', strtolower( $value ) ); }
function sanitize_html_class( $value ) { return preg_replace( '/[^a-zA-Z0-9_-]/', '', $value ); }
function wp_cache_get( $key, $group = '' ) { return $GLOBALS['badge_counts']; }
require_once __DIR__ . '/../includes/class-overseek-review-renderer.php';
require_once __DIR__ . '/../includes/class-overseek-reviews.php';

class Empty_Product_Reviews extends OverSeek_Reviews {
	public function __construct() {}
	public function get_summary( array $args ): array {
		return [ 'total' => 0, 'average' => 0 ];
	}
}

class Rated_Product_Reviews extends OverSeek_Reviews {
	public function __construct() {}
	public function get_summary( array $args ): array {
		return [ 'total' => 23, 'average' => 4.8 ];
	}
}

function check( bool $condition, string $message ): void {
	if ( ! $condition ) { throw new RuntimeException( $message ); }
}

$empty = [ 'total' => 0, 'average' => 0 ];
$rated = [ 'total' => 23, 'average' => 4.8 ];
$html = OverSeek_Review_Renderer::render_summary( $empty, [ 'product_only' => true, 'review_cta' => true ] );
check( str_contains( $html, 'Be the first to review' ), 'Empty products need an invitation.' );
check( ! str_contains( $html, '0.00 / 5' ) && ! str_contains( $html, 'Rated 0' ), 'Empty products must not appear poorly rated.' );
check( ! str_contains( $html, 'os-review-stars' ), 'Empty products must not show empty stars.' );
check( str_contains( $html, 'href="#review_form"' ), 'Keep the review form CTA.' );

$html = OverSeek_Review_Renderer::render_summary( $empty, [ 'store_summary' => $rated, 'product_summary' => $empty ] );
check( str_contains( $html, '4.80 / 5' ) && str_contains( $html, 'Be the first to review' ), 'Keep store scores and empty product states separate.' );
check( substr_count( $html, '4.80 / 5' ) === 1, 'Never reuse a store score as a product rating.' );
$html = OverSeek_Review_Renderer::render_summary( $rated );
check( str_contains( $html, 'Be the first to review' ), 'Missing product data must not fall back to a store score.' );
$html = OverSeek_Review_Renderer::render_summary( $rated, [ 'product_only' => true ] );
check( str_contains( $html, '4.80 / 5' ) && ! str_contains( $html, 'Store rating' ), 'Preserve genuine product scores.' );
$html = OverSeek_Review_Renderer::render_summary( $empty );
check( str_contains( $html, 'No store reviews yet' ) && ! str_contains( $html, '0.00 / 5' ), 'Empty store scores need an honest empty state.' );
$reviews = new Empty_Product_Reviews();
$html = $reviews->render_review_stars_shortcode( [ 'product_id' => 42 ] );
check( str_contains( $html, 'Be the first to review' ) && str_contains( $html, '/42#review_form' ), 'Compact empty ratings should invite a review.' );
$html = $reviews->render_review_stars_shortcode( [ 'product_id' => 42, 'link' => 'false' ] );
check( str_contains( $html, 'Be the first to review' ) && ! str_contains( $html, '<a' ), 'Respect disabled compact-rating links.' );
$html = ( new Rated_Product_Reviews() )->render_review_stars_shortcode( [ 'product_id' => 42 ] );
check( str_contains( $html, '--os-review-stars-fill:96%' ), 'A compact 4.8 rating must fill 96% of the five stars.' );
check( str_contains( $html, 'Rated 4.8 out of 5' ) && str_contains( $html, '(23 reviews)' ), 'Keep the precise accessible rating and review count.' );
foreach ( [ '0' => '0', '1' => '20', '4.5' => '90', '4.8' => '96', '5' => '100', '6' => '100', '-1' => '0' ] as $rating => $fill ) {
	$html = OverSeek_Review_Renderer::render_stars( (float) $rating );
	check( str_contains( $html, '--os-review-stars-fill:' . $fill . '%' ), 'Shared star fill must preserve fractions and clamp invalid ranges.' );
}
$badge_method = new ReflectionMethod( OverSeek_Reviews::class, 'get_trust_badges' );
foreach ( [ 0 => 0, 4 => 0, 5 => 5, 24 => 5, 25 => 25, 499 => 25, 500 => 500, 749 => 500, 750 => 750, 1000 => 1000, 1500 => 1500, 2999 => 1500, 3000 => 3000, 5000 => 5000, 10000 => 5000 ] as $count => $tier ) {
	$GLOBALS['badge_counts'] = [ 'approved' => 10000, 'hold' => 0, 'verified' => $count ];
	$badges = $badge_method->invoke( $reviews );
	check( $badges[0]['tier'] === 'platinum', 'Award Platinum when at least 95% of active reviews are published.' );
	$verified = array_values( array_filter( $badges, fn( $badge ) => 'verified' === $badge['type'] ) );
	check( $tier > 0 ? (int) $verified[0]['tier'] === $tier : empty( $verified ), 'Select the highest earned artwork threshold.' );
	foreach ( $badges as $badge ) {
		check( str_ends_with( $badge['asset_url'], '.webp' ), 'Every awarded badge must have a bundled WebP.' );
	}
}
$html = OverSeek_Review_Renderer::render_summary( $rated, [ 'trust_badges' => $badges ] );
check( substr_count( $html, 'os-review-trust-badge--image' ) === 2, 'Render both supplied badge images.' );
check( str_contains( $html, 'alt="Transparency Platinum. 100% of active reviews published"' ), 'Retain accessible badge meaning and eligibility details.' );
check( ! str_contains( $html, '<svg' ), 'Image badges must not retain the old decorative icon treatment.' );
foreach ( [ [ 9499, 'gold' ], [ 9500, 'platinum' ], [ 9501, 'platinum' ], [ 10000, 'platinum' ] ] as [ $approved, $expected ] ) {
	$GLOBALS['badge_counts'] = [ 'approved' => $approved, 'hold' => 10000 - $approved, 'verified' => 0 ];
	$badges = $badge_method->invoke( $reviews );
	check( $badges[0]['tier'] === $expected, 'Use the actual publication percentage, not its rounded display value, for Platinum eligibility.' );
	check( str_ends_with( $badges[0]['asset_url'], 'transparency-' . $expected . '.webp' ), 'Select the matching transparency artwork.' );
}
echo "Review summary regressions passed.\n";
