<?php
/** Standalone snapshot/HPOS CRUD boundary harness. @package OverSeek */
declare(strict_types=1);
define( 'ABSPATH', __DIR__ );
require_once __DIR__ . '/../includes/class-overseek-delivery-order-snapshot.php';
require_once __DIR__ . '/../includes/class-overseek-delivery-engine.php';

function check( bool $ok, string $label ): void {
	if ( ! $ok ) {
		throw new RuntimeException( $label );
	}
}

$shared = json_decode( file_get_contents( __DIR__ . '/../../packages/overseek-core/test-fixtures/delivery-estimate-snapshot-v1.json' ), true, 512, JSON_THROW_ON_ERROR );
check( null !== OverSeek_Delivery_Order_Snapshot::parse( $shared['base'] ), 'shared base' );
foreach ( $shared['cases'] as $case ) {
	foreach ( [ $case['snapshot'], json_encode( $case['snapshot'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS ) ] as $value ) {
		$parsed = OverSeek_Delivery_Order_Snapshot::parse( $value );
		check( $case['valid'] === ( null !== $parsed ), 'shared fixture: ' . $case['name'] );
		if ( $case['valid'] ) {
			check( $parsed === $case['snapshot'], 'shared fixture unchanged: ' . $case['name'] );
		}
	}
}

class WC_Order {
	public static array $rows = [];
	public static int $writes = 0;
	public static bool $fail = false;
	private array $meta = [];
	private int $id;
	public function __construct( int $id = 0 ) { $this->id = $id; }
	public function get_id(): int { return $this->id; }
	public function get_type(): string { return 'shop_order'; }
	public function read_meta_data( bool $force ): void {
		check( $force && $GLOBALS['wpdb']->held, 'forced CRUD reread under lock' );
		$this->meta = self::$rows[ $this->id ] ?? [];
	}
	public function get_meta_data(): array {
		return array_map( static function ( $row ) {
			return new class( $row ) {
				private array $row;
				public function __construct( array $row ) { $this->row = $row; }
				public function get_data(): array { return $this->row; }
			};
		}, $this->meta );
	}
	public function get_meta( string $key, bool $single ) {
		foreach ( $this->meta as $row ) {
			if ( $row['key'] === $key ) { return $row['value']; }
		}
		return '';
	}
	public function add_meta_data( string $key, $value, bool $unique ): void {
		check( $unique && $GLOBALS['wpdb']->held, 'unique CRUD addition under lock' );
		$this->meta[] = compact( 'key', 'value' );
	}
	public function save_meta_data(): void {
		check( $GLOBALS['wpdb']->held, 'save under lock' );
		if ( self::$fail ) { throw new RuntimeException( 'storage failure' ); }
		++self::$writes;
		self::$rows[ $this->id ] = $this->meta;
	}
}
class Refund_Order extends WC_Order {
	public function get_type(): string { return 'shop_order_refund'; }
}
$wpdb = new class {
	public string $prefix = 'wp_';
	public bool $held = false;
	public bool $timeout = false;
	public $on_lock = null;
	public function prepare( string $sql, ...$args ): array { return [ $sql, $args ]; }
	public function get_var( array $query ) {
		[ $sql, $args ] = $query;
		check( strlen( $args[0] ) <= 64, 'bounded lock name' );
		if ( 'SELECT GET_LOCK(%s, %d)' === $sql ) {
			check( 5 === $args[1], 'bounded timeout' );
			if ( $this->timeout ) { return '0'; }
			$this->held = true;
			if ( $this->on_lock ) { ( $this->on_lock )(); $this->on_lock = null; }
			return '1';
		}
		check( 'SELECT RELEASE_LOCK(%s)' === $sql, 'no order-table SQL' );
		$this->held = false;
		return '1';
	}
};

$input = json_decode( file_get_contents( __DIR__ . '/delivery-engine-fixture.json' ), true );
$result = OverSeek_Delivery_Engine::calculate( $input );
$method = [ 'methodId' => 'flat_rate', 'instanceId' => 7, 'rateId' => 'flat_rate:7', 'title' => 'Standard delivery' ];
$clock = '2026-09-21T12:00:00.000Z';
$snapshot = OverSeek_Delivery_Order_Snapshot::build( $result, $method, 'delivery', $clock );
check( null !== $snapshot && null === $snapshot['collection'], 'canonical delivery' );
check( $snapshot === OverSeek_Delivery_Order_Snapshot::parse( json_encode( $snapshot ) ), 'JSON round trip' );
foreach ( [ 'wbs', 'wbsng' ] as $provider ) {
	$opaque = [ 'methodId' => $provider, 'instanceId' => 0, 'rateId' => $provider . ':hash_standard', 'title' => 'Standard' ];
	$calculation = $result; $calculation['methods'][0]['id'] = $opaque['rateId'];
	$global = OverSeek_Delivery_Order_Snapshot::build( $calculation, $opaque, 'delivery', $clock );
	check( null !== $global && $global['method'] === $opaque, 'global opaque factory ' . $provider );
}

$mutations = [
	static function ( &$v ) { $v['extra'] = true; },
	static function ( &$v ) { unset( $v['collection'] ); },
	static function ( &$v ) { $v['version'] = '1'; },
	static function ( &$v ) { $v['dispatch']['min'] = '2026-02-30'; },
	static function ( &$v ) { $v['dispatch']['max'] = '2020-01-01'; },
	static function ( &$v ) { $v['delivery']['min'] = '2020-01-01'; },
	static function ( &$v ) { $v['delivery']['max'] = $v['dispatch']['min']; },
	static function ( &$v ) { $v['collection'] = $v['delivery']; },
	static function ( &$v ) { $v['delivery'] = null; },
	static function ( &$v ) { $v['dispatch']['min'] .= 'T00:00:00Z'; },
	static function ( &$v ) { $v['capturedAt'] = '2026-02-30T12:00:00Z'; },
	static function ( &$v ) { $v['capturedAt'] = '2026-09-21T24:00:00Z'; },
	static function ( &$v ) { $v['capturedAt'] = '2026-09-21T12:00:00+01:00'; },
	static function ( &$v ) { $v['timezone'] = '+10:00'; },
	static function ( &$v ) { $v['timezone'] = 'Factory'; },
	static function ( &$v ) { $v['method']['instanceId'] = '7'; },
	static function ( &$v ) { $v['method']['instanceId'] = -1; },
	static function ( &$v ) { $v['method']['methodId'] = 'bad.method'; },
	static function ( &$v ) { $v['method']['rateId'] = 'bad rate'; },
	static function ( &$v ) { $v['method']['title'] = ''; },
	static function ( &$v ) { $v['method']['title'] = str_repeat( 'x', 8193 ); },
	static function ( &$v ) { $v['method']['title'] = "bad\xff"; },
	static function ( &$v ) { $v['method']['extra'] = 1; },
];
foreach ( $mutations as $i => $mutate ) {
	$bad = $snapshot; $mutate( $bad );
	check( null === OverSeek_Delivery_Order_Snapshot::parse( $bad ), 'invalid snapshot ' . $i );
}
check( null === OverSeek_Delivery_Order_Snapshot::parse( str_repeat( ' ', 8193 ) . json_encode( $snapshot ) ), 'raw JSON byte limit' );
$pickup = [ 'methodId' => 'local_pickup', 'instanceId' => 8, 'rateId' => 'local_pickup:8', 'title' => 'Collect from store' ];
$collection = OverSeek_Delivery_Order_Snapshot::build( $result, $pickup, 'collection', $clock );
check( null !== $collection && null === $collection['delivery'] && $collection['collection'] === $collection['dispatch'] && 'Collect from store' === $collection['method']['title'], 'collection branch, readiness and wording' );
check( null === OverSeek_Delivery_Order_Snapshot::build( $result, $pickup, 'delivery', $clock ), 'selected type mismatch' );
$missing = $method; $missing['rateId'] = 'flat_rate:9'; $missing['instanceId'] = 9;
check( null === OverSeek_Delivery_Order_Snapshot::build( $result, $missing, 'delivery', $clock ), 'selected rate absent' );
$duplicate = $result; $duplicate['methods'][] = $duplicate['methods'][0];
check( null === OverSeek_Delivery_Order_Snapshot::build( $duplicate, $method, 'delivery', $clock ), 'duplicate rates' );

$order = new WC_Order( 42 );
$write = static function ( $r = null, $m = null, $o = null, $context = 'final_verified_checkout' ) use ( $result, $method, $clock, $order ): string {
	return OverSeek_Delivery_Order_Snapshot::write_first( $o ?? $order, $r ?? $result, $m ?? $method, 'delivery', $clock, $context );
};
check( 'invalid' === $write( [] ), 'missing calculation' );
check( 'invalid' === $write( [ 'status' => 'unavailable', 'reason' => 'receipt_safety_unverified' ] ), 'unavailable calculation' );
check( 'invalid' === $write( $result, $missing ), 'no selected rate writes' );
foreach ( [ 'preview', 'cart', 'product', 'synthetic_fixture', '' ] as $context ) {
	check( 'invalid_context' === $write( null, null, null, $context ), 'non-checkout context' );
}
foreach ( [ new stdClass(), new WC_Order(), new Refund_Order( 42 ) ] as $not_order ) {
	check( 'invalid_context' === $write( null, null, $not_order ), 'non-order context' );
}
check( 0 === WC_Order::$writes, 'no invalid writes' );
$wpdb->timeout = true;
check( 'lock_unavailable' === $write() && 0 === WC_Order::$writes, 'timeout fails closed' );
$wpdb->timeout = false;
check( 'written' === $write() && ! $wpdb->held, 'first CRUD write and release' );
check( 'existing' === $write() && 1 === WC_Order::$writes, 'idempotence' );
$changed = $method; $changed['title'] = 'Renamed rate';
check( 'conflict' === $write( null, $changed ) && 1 === WC_Order::$writes, 'metadata changes never overwrite' );
$key = OverSeek_Delivery_Order_Snapshot::META_KEY;
WC_Order::$rows[42][] = [ 'key' => $key, 'value' => $snapshot ];
check( 'existing' === $write(), 'identical duplicates retained' );
WC_Order::$rows[42][] = [ 'key' => $key, 'value' => $collection ];
check( 'conflict' === $write(), 'conflicting valid duplicates' );
WC_Order::$rows[42] = [ [ 'key' => $key, 'value' => '' ] ];
check( 'conflict' === $write(), 'invalid existing row never replaced' );
WC_Order::$rows[42] = [];
$wpdb->on_lock = static function () use ( $key, $snapshot ) { WC_Order::$rows[42][] = [ 'key' => $key, 'value' => $snapshot ]; };
check( 'existing' === $write() && 1 === WC_Order::$writes, 'concurrent winner reread under lock' );
WC_Order::$rows[42] = []; WC_Order::$fail = true;
check( 'storage_error' === $write() && ! $wpdb->held, 'exception releases lock' );
WC_Order::$fail = false;
check( 'written' === OverSeek_Delivery_Order_Snapshot::write_first( $order, $result, $pickup, 'collection', $clock, 'final_verified_checkout' ), 'collection CRUD write' );
check( WC_Order::$rows[42][0]['value'] === $collection, 'persist exact collection snapshot' );

// Exercise changed parser rules through the factory and writer, not just parse().
$variants = [
	[ 'flat_rate', 0, str_repeat( '配送', 150 ), true ],
	[ 'flat_rate:0:EXPRESS_1:zone-A', 0, str_repeat( '🚚', 150 ), true ],
	[ 'flat_rate:0:', 0, 'Standard', true ],
	[ 'flat_rate:00', 0, 'Standard', true ],
	[ 'flat_rate:0::express', 0, 'Standard', true ],
	[ 'flat_rate:0:zone.a', 0, 'Standard', true ],
	[ 'flat_rate', 7, 'Standard', true ],
	[ 'flat_rate:0', 0, str_repeat( '🚚', 150 ) . 'x', false ],
	[ 'flat_rate:0', 0, "\u{00A0}Standard", false ],
	[ 'flat_rate:0', 0, "Standard\u{FEFF}", false ],
	[ 'flat_rate:0', 0, "Delivery/配送\u{2028}Standard", true ],
];
foreach ( $variants as $i => [ $rate, $instance, $title, $valid ] ) {
	$candidate = $method;
	$candidate['instanceId'] = $instance; $candidate['rateId'] = $rate; $candidate['title'] = $title;
	$calculation = $result; $calculation['methods'][0]['id'] = $rate;
	$instant = '2026-09-21T12:00:00.' . ( $i % 2 ? '12' : '1' ) . 'Z';
	check( $valid === ( null !== OverSeek_Delivery_Order_Snapshot::build( $calculation, $candidate, 'delivery', $instant ) ), 'updated build ' . $i );
	$before = WC_Order::$writes;
	$status = OverSeek_Delivery_Order_Snapshot::write_first( new WC_Order( 100 + $i ), $calculation, $candidate, 'delivery', $instant, 'final_verified_checkout' );
	check( ( $valid ? 'written' : 'invalid' ) === $status && WC_Order::$writes === $before + ( $valid ? 1 : 0 ), 'updated write ' . $i );
}
foreach ( [ 128, 129, 200, 201 ] as $length ) {
	$rate = 'flat_rate:7:' . str_repeat( 'a', $length - strlen( 'flat_rate:7:' ) );
	$value = $snapshot; $value['method']['rateId'] = $rate;
	check( ( $length <= 200 ) === ( null !== OverSeek_Delivery_Order_Snapshot::parse( $value ) ), 'snapshot rate limit ' . $length );
	$calculation = $result; $calculation['methods'][0]['id'] = $rate;
	check( ( $length <= 200 ) === ( null !== OverSeek_Delivery_Order_Snapshot::build( $calculation, $value['method'], 'delivery', $clock ) ), 'engine rate limit ' . $length );
}
foreach ( [ 100, 101 ] as $length ) {
	$value = $snapshot; $value['method']['methodId'] = str_repeat( 'a', $length );
	$value['method']['rateId'] = $value['method']['methodId'] . ':7';
	check( ( 100 === $length ) === ( null !== OverSeek_Delivery_Order_Snapshot::parse( $value ) ), 'method ID limit' );
}
foreach ( [ 'UTC', 'Etc/UTC', 'US/Eastern', 'Australia/Sydney' ] as $timezone ) {
	$value = $snapshot; $value['timezone'] = $timezone;
	check( null !== OverSeek_Delivery_Order_Snapshot::parse( $value ), 'standard timezone alias ' . $timezone );
}
fwrite( STDOUT, 'Delivery order snapshot harness passed (' . count( $shared['cases'] ) . " shared parity cases, array + JSON)\n" );
