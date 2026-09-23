<?php
/** Minimal strict Woo/WordPress doubles; no bootstrap, DB or network. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;
$assertions = 0; $reads = 0; $hooks = []; $catalogue = []; $passwords = []; $json = null;
$options = []; $filters = []; $external_cache = false; $cached_version = false;
function same( $expected, $actual, string $name ): void {
	++$GLOBALS['assertions'];
	if ( $expected !== $actual ) { throw new RuntimeException( $name . ': ' . json_encode( [ $expected, $actual ] ) ); }
}
function __( $text, $domain ) { return $text; }
function esc_html( $text ) { return htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' ); }
function esc_attr( $text ) { return esc_html( $text ); }
function esc_html__( $text, $domain ) { return esc_html( $text ); }
function get_option( $key, $default = false ) { ++$GLOBALS['reads']; return 'date_format' === $key ? ( $GLOBALS['date_format'] ?? 'Y-m-d' ) : ( $GLOBALS['options'][$key] ?? $default ); }
function has_filter( $hook ) { return $GLOBALS['filters'][$hook] ?? false; }
function wp_json_encode( $value ) { return json_encode( $value ); }
function wp_using_ext_object_cache() { return $GLOBALS['external_cache']; }
function wp_cache_get( $key, $group ) {
	if ( 'shipping-transient-version' !== $key || 'transient' !== $group ) { throw new RuntimeException( 'Unexpected cache read' ); }
	return $GLOBALS['cached_version'];
}
function get_transient( ...$args ) { throw new RuntimeException( 'Potential transient expiry write forbidden' ); }
function set_transient( ...$args ) { throw new RuntimeException( 'Transient write forbidden' ); }
function update_option( ...$args ) { throw new RuntimeException( 'Option write forbidden' ); }
class WC_Cache_Helper {
	public static function get_transient_version( ...$args ) { throw new RuntimeException( 'Potential version initialization write forbidden' ); }
}
function wp_date( $format, $timestamp, $timezone ) { return ( new DateTimeImmutable( '@' . $timestamp ) )->setTimezone( $timezone )->format( $format ); }
function WC() { ++$GLOBALS['reads']; return $GLOBALS['woo']; }
function wc_get_product( $id ) { ++$GLOBALS['reads']; return $GLOBALS['catalogue'][$id] ?? false; }
function get_post_field( $field, $id ) { return $GLOBALS['passwords'][$id] ?? ''; }
function add_action( $hook, $callback ) { $GLOBALS['hooks'][$hook][] = $callback; }
function add_shortcode( $name, $callback ) { $GLOBALS['hooks'][$name][] = $callback; }
function wp_register_script( ...$args ) { $GLOBALS['registered_scripts'][$args[0]] = $args; }
function plugins_url( $path, $file ) { return $path; }
function register_block_type( $path, $args ) { $GLOBALS['block'] = [ $path, $args ]; }
function wp_enqueue_script( ...$args ) { throw new RuntimeException( 'Assets forbidden' ); }
function wp_enqueue_style( ...$args ) { throw new RuntimeException( 'Assets forbidden' ); }
function wp_remote_get( ...$args ) { throw new RuntimeException( 'Network forbidden' ); }
function wp_remote_post( ...$args ) { throw new RuntimeException( 'Network forbidden' ); }
function nocache_headers() { $GLOBALS['no_cache'] = true; }
function wp_send_json( $data, $status = 200 ) { $GLOBALS['json'] = $data; }
class WC_Product {
	public $status = 'publish'; public $type = 'simple'; public $parent = 0;
	public function __construct( public int $id ) {}
	public function get_id() { return $this->id; }
	public function get_status() { return $this->status; }
	public function is_type( $type ) { return in_array( $this->type, (array) $type, true ); }
	public function get_parent_id() { return $this->parent; }
	public function is_virtual() { return false; }
	public function needs_shipping() { return true; }
	public function __call( $name, $args ) { throw new RuntimeException( 'Unexpected product access: ' . $name ); }
}
class WC_Product_Variation extends WC_Product {
	public $active = true;
	public function variation_is_active() { return $this->active; }
	public function variation_is_visible() { return true; }
}
class WC_Shipping_Rate {
	public function __construct( public $id, $label = '', $cost = 0, $taxes = [], public $method = '', public $instance = 0 ) {}
	public function get_id() { return $this->id; }
	public function get_method_id() { return $this->method; }
	public function get_instance_id() { return $this->instance; }
}
class Read_Only_Customer {
	public $calculated = false; public $id = 0;
	public function get_calculated_shipping() { return $this->calculated; }
	public function get_id() { return $this->id; }
	public $destination = [ 'country' => '', 'state' => '', 'postcode' => '', 'city' => '', 'address' => '', 'address_2' => '' ];
	public function __call( $name, $args ) {
		$field = str_replace( 'get_shipping_', '', $name );
		if ( 'address_1' === $field ) { $field = 'address'; }
		if ( ! array_key_exists( $field, $this->destination ) ) { throw new RuntimeException( 'Customer mutation' ); }
		return $this->destination[$field];
	}
}
class Read_Only_Cart {
	public array $lines = []; public array $packages = [];
	public function get_cart() { return $this->lines; }
	public function get_shipping_packages() { return $this->packages; }
	public function __call( $name, $args ) { throw new RuntimeException( 'Cart mutation/calculation' ); }
}
class Read_Only_Shipping {
	public array $packages = [];
	public function get_packages() { return $this->packages; }
	public function __call( $name, $args ) { throw new RuntimeException( 'Shipping calculation' ); }
}
class Read_Only_Session {
	public array $chosen = []; public array $values = [];
	public function get( $key, $default = null ) { return 'chosen_shipping_methods' === $key ? $this->chosen : ( $this->values[$key] ?? $default ); }
	public function __call( $name, $args ) { throw new RuntimeException( 'Session mutation' ); }
}
$woo = (object) [ 'cart' => new Read_Only_Cart(), 'customer' => new Read_Only_Customer(), 'shipping' => new Read_Only_Shipping(), 'session' => new Read_Only_Session() ];
