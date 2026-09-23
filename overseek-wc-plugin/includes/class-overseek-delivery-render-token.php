<?php
/** Batched read-only revision/receipt/stock fence; never persisted. @package OverSeek */
declare(strict_types=1);
defined( 'ABSPATH' ) || exit;

final class OverSeek_Delivery_Render_Token {
	/** Input writers atomically advance revision/hash; guard writers advance sequence/operation. */
	public static function read( string $account, array $ids, DateTimeImmutable $now ): array {
		global $wpdb;
		if ( ! $ids || count( $ids ) > 600 ) { throw new RuntimeException( 'cache_bounds' ); }
		foreach ( $ids as $id ) { if ( ! is_int( $id ) || $id < 1 ) { throw new RuntimeException( 'cache_identity' ); } }
		$list = implode( ',', $ids ); // Validated integers only; account remains a bound parameter.
		$inputs = $wpdb->prefix . 'overseek_delivery_inputs';
		$guards = $wpdb->prefix . 'overseek_receipt_guards';
		$sql = $wpdb->prepare(
			"SELECT 'input' AS kind, CONCAT(scope,':',entity_id) AS identity, CAST(revision AS CHAR) AS a, payload_hash AS b,
			CASE WHEN scope='inbound' THEN JSON_UNQUOTE(JSON_EXTRACT(payload,'$.generatedAt')) ELSE '' END AS c,
			CASE WHEN scope='inbound' THEN JSON_UNQUOTE(JSON_EXTRACT(payload,'$.expiresAt')) ELSE '' END AS d
			FROM {$inputs} WHERE account_id=%s AND ((entity_id=0 AND scope IN ('control','settings')) OR (entity_id IN ({$list}) AND scope IN ('product','inbound')))
			UNION ALL SELECT 'guard', CAST(owner_id AS CHAR), operation_id, CAST(sequence AS CHAR), CAST(guard_active AS CHAR), ''
			FROM {$guards} WHERE account_id=%s AND owner_id IN ({$list})
			UNION ALL SELECT 'stock', CONCAT(post_id,':',meta_id), meta_key, meta_value, '', ''
			FROM {$wpdb->postmeta} WHERE post_id IN ({$list}) AND meta_key IN ('_stock','_stock_status','_manage_stock','_backorders')
			ORDER BY kind, identity LIMIT 4097", $account, $account
		);
		$previous = $wpdb->suppress_errors( true );
		try {
			$rows = $wpdb->get_results( $sql, ARRAY_A );
			if ( $wpdb->last_error || ! is_array( $rows ) || ! $rows || count( $rows ) > 4096 ) { throw new RuntimeException( 'cache_fence_unavailable' ); }
			foreach ( $rows as &$row ) {
				// Cross a generated/expiry boundary even when no writer changes the revision.
				if ( 'input' === $row['kind'] && str_starts_with( $row['identity'], 'inbound:' ) ) {
					$row['fresh'] = is_string( $row['c'] ) && is_string( $row['d'] ) && $row['c'] && $row['d']
						&& new DateTimeImmutable( $row['c'] ) <= $now && $now < new DateTimeImmutable( $row['d'] );
				}
			}
			unset( $row );
			return $rows;
		} finally { $wpdb->suppress_errors( $previous ); }
	}
}
