<?php
/** Read-only native-interface doubles for the REAL adapter, gate, token and context. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;
require __DIR__ . '/delivery-storefront.php';
function get_site_option( $name, $default = false ) { return $GLOBALS['site_options'][$name] ?? $default; }
function add_filter( ...$args ) { add_action( ...$args ); }
function remove_filter( ...$args ) {}
function is_admin() { return false; }
function is_cart() { return true; }
function is_checkout() { return false; }
function is_order_received_page() { return false; }
function is_checkout_pay_page() { return false; }
function wc_get_order( $id ) { return $GLOBALS['orders'][$id] ?? null; }
function wc_get_held_stock_quantity( $owner, $exclude = 0 ) {
	++$GLOBALS['wpdb']->num_queries;
	if ( $GLOBALS['held_hook'] ?? null ) { ( $GLOBALS['held_hook'] )(); }
	return $GLOBALS['held'][$exclude] ?? 0;
}
class WC_Data_Store {
	public static function load( $name ) { return new self(); }
	public function get_current_class_name() { return 'WC_Product_Data_Store_CPT'; }
}
class Render_Product extends WC_Product {
	public $stock = 20; public $stock_status = 'instock'; public $managed = true; public $owner = 10;
	public function get_type() { return $this->type; }
	public function is_purchasable() { return true; }
	public function get_stock_managed_by_id() { return $this->owner; }
	public function managing_stock() { return $this->managed; }
	public function get_stock_quantity() { return $this->stock; }
	public function get_stock_status() { return $this->stock_status; }
	public function backorders_allowed() { return false; }
	public function get_data_store() { return WC_Data_Store::load( 'product' ); }
	public function __sleep() { throw new RuntimeException( 'Object serialization forbidden' ); }
}
class Render_Rate extends WC_Shipping_Rate {
	public $metadata = []; public $cost = '10';
	public function get_meta_data() { return $this->metadata; }
	public function get_cost() { return $this->cost; }
	public function get_taxes() { return [ '1' => '2' ]; }
	public function get_label() { return 'Service'; }
	public function get_delivery_time() { return $GLOBALS['display']->delivery_time( '', $this ); }
	public function __sleep() { throw new RuntimeException( 'Rate serialization forbidden' ); }
}
class Render_Cart extends Read_Only_Cart { public function get_cart_hash() { return hash( 'sha256', json_encode( array_map( static fn( $line ) => $line['quantity'], $this->lines ) ) ); } }
class Render_Woo {
	public $cart; public $customer; public $shipping; public $session;
	public function shipping() { return $this->shipping; }
}
class wpdb {
	public $prefix = 'wp_'; public $postmeta = 'wp_postmeta'; public $last_error = ''; public $last_query = ''; public $rows_affected = 0; public $num_queries = 0;
	public $rows = []; public $product_reads = 0; public $batch_reads = 0; public $account = 'linked';
	public $guard = [ 'operation_id' => 'baseline_epoch', 'sequence' => '0', 'guard_active' => '0' ];
	public $stock = [ '_stock' => '20', '_stock_status' => 'instock', '_manage_stock' => 'yes', '_backorders' => 'no' ];
	public function suppress_errors( $value ) { return false; }
	public function prepare( $sql, ...$args ) {
		return preg_replace_callback( '/%[ds]/', static function ( $match ) use ( &$args ) { $value = array_shift( $args ); return '%d' === $match[0] ? (string) (int) $value : "'" . $value . "'"; }, $sql );
	}
	public function get_row( $sql, $mode ) {
		++$this->num_queries;
		if ( ! str_contains( $sql, "'" . $this->account . "'" ) ) { return null; }
		if ( str_contains( $sql, 'overseek_receipt_guards' ) ) { return $this->guard; }
		if ( preg_match( "/scope = '([^']+)' AND entity_id = ([0-9]+)/", $sql, $match ) ) {
			if ( 'product' === $match[1] ) { ++$this->product_reads; }
			$row = $this->rows[ $match[1] . ':' . $match[2] ] ?? null;
			return $row ? [ 'revision' => $row['revision'], 'payload' => json_encode( $row['payload'] ) ] : null;
		}
		throw new RuntimeException( 'Unexpected SQL read: ' . $sql );
	}
	public function get_results( $sql, $mode ) {
		++$this->num_queries;
		if ( ! str_contains( $sql, 'UNION ALL' ) ) {
			return array_map( static fn( $key, $value ) => [ 'meta_key' => $key, 'meta_value' => $value ], array_keys( $this->stock ), $this->stock );
		}
		++$this->batch_reads; $result = [];
		foreach ( $this->rows as $key => $row ) {
			$result[] = [ 'kind' => 'input', 'identity' => $key, 'a' => (string) $row['revision'], 'b' => hash( 'sha256', json_encode( $row['payload'] ) ), 'c' => $row['payload']['generatedAt'] ?? '', 'd' => $row['payload']['expiresAt'] ?? '' ];
		}
		$result[] = [ 'kind' => 'guard', 'identity' => '10', 'a' => $this->guard['operation_id'], 'b' => $this->guard['sequence'], 'c' => $this->guard['guard_active'], 'd' => '' ];
		foreach ( $this->stock as $key => $value ) { $result[] = [ 'kind' => 'stock', 'identity' => '10:' . $key, 'a' => $key, 'b' => $value, 'c' => '', 'd' => '' ]; }
		usort( $result, static fn( $a, $b ) => [ $a['kind'], $a['identity'] ] <=> [ $b['kind'], $b['identity'] ] );
		return $result;
	}
	public function query( ...$args ) { throw new RuntimeException( 'DB write forbidden' ); }
}
$wpdb = new wpdb();
$previous_woo = $woo; $woo = new Render_Woo();
foreach ( get_object_vars( $previous_woo ) as $key => $value ) { $woo->$key = $value; }
$woo->cart = new Render_Cart();
$options['overseek_account_id'] = 'linked';
