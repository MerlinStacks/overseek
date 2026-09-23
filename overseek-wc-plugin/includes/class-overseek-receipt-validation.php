<?php
/** Guarded receipt wire and native Woo identity validation. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

class OverSeek_Receipt_Validation {
	/** Decode an exact envelope into a canonical immutable operation. */
	public function decode( string $body ): array {
		$value = json_decode( $body, false, 8, JSON_THROW_ON_ERROR );
		// json_decode otherwise silently accepts duplicate members (including escaped aliases).
		preg_match_all( '/"(?:[^"\\\\]|\\\\.)*"|[{}:]/s', $body, $tokens );
		$objects = [];
		foreach ( $tokens[0] as $index => $token ) {
			if ( '{' === $token ) {
				$objects[] = [];
			} elseif ( '}' === $token ) {
				array_pop( $objects );
			} elseif ( '"' === $token[0] && ':' === ( $tokens[0][ $index + 1 ] ?? null ) ) {
				$key = json_decode( $token, true, 2, JSON_THROW_ON_ERROR );
				$depth = count( $objects ) - 1;
				if ( isset( $objects[ $depth ][ $key ] ) ) {
					throw new InvalidArgumentException();
				}
				$objects[ $depth ][ $key ] = true;
			}
		}
		$this->keys( $value, [ 'schemaVersion', 'operation' ] );
		if ( 1 !== $value->schemaVersion ) {
			throw new InvalidArgumentException();
		}
		$keys = [ 'operationId', 'sequence', 'productWooId', 'variationWooId', 'stockOwnerWooId', 'delta' ];
		$this->keys( $value->operation, $keys );
		$op = [];
		foreach ( $keys as $key ) {
			$op[ $key ] = $value->operation->$key;
		}
		if ( ! is_string( $op['operationId'] ) || 1 !== preg_match( '/\A[A-Za-z0-9_-]{1,128}\z/', $op['operationId'] ) ) {
			throw new InvalidArgumentException();
		}
		foreach ( [ 'sequence', 'productWooId', 'stockOwnerWooId', 'variationWooId' ] as $key ) {
			if ( 'variationWooId' === $key && null === $op[ $key ] ) {
				continue;
			}
			if ( ! is_int( $op[ $key ] ) || $op[ $key ] < 1 || $op[ $key ] > 9007199254740991 ) {
				throw new InvalidArgumentException();
			}
		}
		if ( ! is_int( $op['delta'] ) || 0 === $op['delta'] || abs( $op['delta'] ) > 1000000 ) {
			throw new InvalidArgumentException();
		}
		if ( ! in_array( $op['stockOwnerWooId'], [ $op['variationWooId'], $op['productWooId'] ], true ) || $op['variationWooId'] === $op['productWooId'] ) {
			throw new InvalidArgumentException();
		}
		return $op;
	}

	private function keys( $value, array $keys ): void {
		if ( ! $value instanceof stdClass ) {
			throw new InvalidArgumentException();
		}
		$actual = array_keys( get_object_vars( $value ) );
		sort( $actual );
		sort( $keys );
		if ( $actual !== $keys ) {
			throw new InvalidArgumentException();
		}
	}

	/** Woo may return integer-valued floats/strings; false/null/empty/fractions are not quantities. */
	public static function quantity( $value ): ?int {
		if ( ! is_int( $value ) && ! is_float( $value ) && ! ( is_string( $value ) && preg_match( '/\A-?\d+(?:\.0+)?\z/', $value ) ) ) {
			return null;
		}
		$number = (float) $value;
		return is_finite( $number ) && abs( $number ) <= 9007199254740991 && floor( $number ) === $number ? (int) $number : null;
	}

	/** Fail closed on missing methods, inherited ownership and custom product types. */
	public function product( array $op ) {
		if ( ! function_exists( 'wc_get_product' ) || ! function_exists( 'wc_update_product_stock' ) ) {
			throw new RuntimeException();
		}
		$product = wc_get_product( $op['stockOwnerWooId'] );
		foreach ( [ 'get_id', 'get_type', 'get_parent_id', 'get_manage_stock', 'managing_stock', 'get_stock_managed_by_id', 'get_stock_quantity' ] as $method ) {
			if ( ! $product instanceof WC_Product || ! is_callable( [ $product, $method ] ) ) {
				throw new InvalidArgumentException();
			}
		}
		if ( $product->get_id() !== $op['stockOwnerWooId'] || true !== $product->get_manage_stock( 'edit' ) || true !== $product->managing_stock() || $product->get_stock_managed_by_id() !== $op['stockOwnerWooId'] ) {
			throw new InvalidArgumentException();
		}
		if ( null === $op['variationWooId'] ) {
			if ( ! in_array( $product->get_type(), [ 'simple', 'variable' ], true ) || 0 !== $product->get_parent_id() ) {
				throw new InvalidArgumentException();
			}
		} else {
			$parent = wc_get_product( $op['productWooId'] );
			$variant = wc_get_product( $op['variationWooId'] );
			if ( ! $variant instanceof WC_Product_Variation || 'variation' !== $variant->get_type() || $variant->get_parent_id() !== $op['productWooId'] || $variant->get_stock_managed_by_id() !== $op['stockOwnerWooId'] || ! $parent instanceof WC_Product || $parent->get_id() !== $op['productWooId'] || 'variable' !== $parent->get_type() ) {
				throw new InvalidArgumentException();
			}
		}
		$quantity = self::quantity( $product->get_stock_quantity( 'edit' ) );
		if ( null === $quantity || abs( $quantity + $op['delta'] ) > 9007199254740991 ) {
			throw new InvalidArgumentException();
		}
		return $product;
	}
}
