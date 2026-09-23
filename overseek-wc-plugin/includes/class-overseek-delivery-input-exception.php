<?php
/** Safe, typed delivery input diagnostics. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Delivery_Input_Exception extends InvalidArgumentException {
	private const REASONS = [ 'schema_invalid', 'inbound_expired', 'inbound_generated_in_future', 'inbound_ttl_invalid', 'product_missing', 'product_type_unsupported', 'variation_missing', 'variation_parent_mismatch', 'stock_owner_mismatch', 'owner_pool_batches_mismatch', 'production_range_invalid', 'supplier_lead_invalid', 'payload_limits_exceeded' ];
	private string $reason;

	public function __construct( string $reason = 'schema_invalid' ) {
		parent::__construct( 'Invalid delivery input.' );
		$this->reason = in_array( $reason, self::REASONS, true ) ? $reason : 'schema_invalid';
	}

	public function reason(): string { return $this->reason; }
}
