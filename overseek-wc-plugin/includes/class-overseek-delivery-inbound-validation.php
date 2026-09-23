<?php
/**
 * Staged inbound projections: validation only, never a receipt safety certificate.
 *
 * @package OverSeek
 */
declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

class OverSeek_Delivery_Inbound_Validation {
	/** Exact UTC validity window; tolerate at most five minutes of sender clock skew. */
	public function validate( $payload, int $parent_id ): void {
		$verified = $payload instanceof stdClass && 'verified' === ( $payload->receiptSafety ?? null );
		$this->keys( $payload, array_merge( [ 'wooId', 'generatedAt', 'expiresAt', 'receiptSafety', 'targets' ], $verified ? [ 'receiptProof' ] : [] ) );
		$this->integer( $payload->wooId, 1, 9007199254740991 );
		$this->valid( $payload->wooId === $parent_id && in_array( $payload->receiptSafety, [ 'unverified', 'verified' ], true ) );
		$owners = [];
		if ( $verified ) {
			$proof = $payload->receiptProof;
			$this->keys( $proof, [ 'version', 'epoch', 'owners' ] );
			$this->valid( 1 === $proof->version && is_string( $proof->epoch ) && 1 === preg_match( '/\A[A-Za-z0-9_-]{1,64}\z/', $proof->epoch ) && is_array( $proof->owners ) && count( $proof->owners ) > 0 && count( $proof->owners ) <= 1001 );
			foreach ( $proof->owners as $owner ) {
				$this->keys( $owner, [ 'stockOwnerWooId', 'sequence', 'operationId' ] );
				$this->integer( $owner->stockOwnerWooId, 1, 9007199254740991 );
				$this->integer( $owner->sequence, 0, 9007199254740991 );
				$this->valid( ! isset( $owners[ $owner->stockOwnerWooId ] ) && is_string( $owner->operationId ) && 1 === preg_match( '/\A[A-Za-z0-9_-]{1,128}\z/', $owner->operationId ) );
				$owners[ $owner->stockOwnerWooId ] = true;
			}
		}
		$generated = $this->instant( $payload->generatedAt );
		$expires = $this->instant( $payload->expiresAt );
		$now = new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
		$this->valid( $expires == $generated->modify( '+24 hours' ) && $expires > $now && $generated <= $now->modify( '+5 minutes' ) );
		$this->valid( is_array( $payload->targets ) && count( $payload->targets ) <= 1001 );
		// Removed products must still be clearable without any Woo lookup.
		if ( [] === $payload->targets ) {
			return;
		}
		$parent = wc_get_product( $parent_id );
		$this->valid( $parent instanceof WC_Product && ! ( $parent instanceof WC_Product_Variation ) && $parent->get_id() === $parent_id && 'trash' !== $parent->get_status() );
		$seen = [];
		$total = 0;
		$pools = [];
		$target_owners = [];
		foreach ( $payload->targets as $target ) {
			$this->keys( $target, [ 'wooId', 'stockOwnerWooId', 'state', 'supplierLead', 'batches' ] );
			$this->integer( $target->wooId, 1, 9007199254740991 );
			$this->valid( ! isset( $seen[ $target->wooId ] ) );
			$seen[ $target->wooId ] = true;
			$this->valid( in_array( $target->state, [ 'pending', 'unsupported', 'integrity_error' ], true ) );
			$local = $target->wooId === $parent_id ? $parent : wc_get_product( $target->wooId );
			$this->valid( $local instanceof WC_Product && $local->get_id() === $target->wooId && 'trash' !== $local->get_status() );
			$this->valid( $target->wooId === $parent_id || ( $parent->is_type( 'variable' ) && $local instanceof WC_Product_Variation && $local->is_type( 'variation' ) && $local->get_parent_id() === $parent_id ) );
			if ( null !== $target->stockOwnerWooId ) {
				$this->integer( $target->stockOwnerWooId, 1, 9007199254740991 );
				$this->valid( in_array( $target->stockOwnerWooId, [ $target->wooId, $parent_id ], true ) && $local->get_stock_managed_by_id() === $target->stockOwnerWooId );
				$this->valid( ! $verified || 'pending' !== $target->state || isset( $owners[ $target->stockOwnerWooId ] ) );
				if ( 'pending' === $target->state ) { $target_owners[ $target->stockOwnerWooId ] = true; }
			} else {
				$this->valid( 'pending' !== $target->state );
			}
			$this->valid( 'pending' !== $target->state || $local->is_type( [ 'simple', 'variation' ] ) );
			if ( null !== $target->supplierLead ) {
				$this->keys( $target->supplierLead, [ 'min', 'max' ] );
				$this->integer( $target->supplierLead->min, 0, 3650 );
				$this->integer( $target->supplierLead->max, 0, 3650 );
				$this->valid( $target->supplierLead->min <= $target->supplierLead->max );
			}
			$this->valid( is_array( $target->batches ) );
			$pool = $target->stockOwnerWooId;
			$pool_value = json_encode( [ $target->batches, $target->supplierLead ] );
			if ( null === $pool || ! isset( $pools[ $pool ] ) ) { $total += count( $target->batches ); }
			if ( null !== $pool ) {
				$this->valid( ! isset( $pools[ $pool ] ) || $pools[ $pool ] === $pool_value );
				$pools[ $pool ] = $pool_value;
			}
			$this->valid( $total <= 1000 && ( 'pending' === $target->state || [] === $target->batches ) );
			$dates = [];
			foreach ( $target->batches as $batch ) {
				$this->keys( $batch, [ 'dueDate', 'quantity' ] );
				$this->valid( is_string( $batch->dueDate ) && 1 === preg_match( '/\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/', $batch->dueDate ) );
				$date = DateTimeImmutable::createFromFormat( '!Y-m-d', $batch->dueDate, new DateTimeZone( 'UTC' ) );
				$this->valid( false !== $date && $date->format( 'Y-m-d' ) === $batch->dueDate && substr( $batch->dueDate, 0, 4 ) !== '0000' && ! isset( $dates[ $batch->dueDate ] ) );
				$dates[ $batch->dueDate ] = true;
				$this->integer( $batch->quantity, 1, 1000000 );
			}
		}
		if ( $verified ) { $this->valid( [] === array_diff_key( $owners, $target_owners ) ); }
	}

	/** Parse UTC ISO instants strictly, including real calendar dates and fractional seconds. */
	private function instant( $value ): DateTimeImmutable {
		$this->valid( is_string( $value ) && 1 === preg_match( '/\A([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,6}))?Z\z/', $value, $parts ) );
		$normalized = $parts[1] . '.' . str_pad( $parts[2] ?? '', 6, '0' ) . 'Z';
		$date = DateTimeImmutable::createFromFormat( '!Y-m-d\TH:i:s.u\Z', $normalized, new DateTimeZone( 'UTC' ) );
		$this->valid( false !== $date && $date->format( 'Y-m-d\TH:i:s.u\Z' ) === $normalized && substr( $normalized, 0, 4 ) !== '0000' );
		return $date;
	}

	/** Exact wire keys prevent accidental acceptance of safety or stock-write fields. */
	private function keys( $value, array $keys ): void {
		$this->valid( $value instanceof stdClass );
		$actual = array_keys( get_object_vars( $value ) );
		$this->valid( [] === array_diff( $keys, $actual ) && [] === array_diff( $actual, $keys ) );
	}

	/** Normalize integer JSON spellings before the existing canonical payload hash. */
	private function integer( &$value, int $min, int $max ): void {
		$this->valid( ( is_int( $value ) || is_float( $value ) ) && is_finite( (float) $value ) && floor( (float) $value ) === (float) $value && $value >= $min && $value <= $max );
		$value = (int) $value;
	}

	private function valid( bool $valid ): void {
		if ( ! $valid ) {
			throw new InvalidArgumentException( 'Invalid delivery input.' );
		}
	}
}
