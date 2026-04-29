<?php
/**
 * Cart Recovery Handler
 *
 * Restores WooCommerce carts from OverSeek recovery links.
 *
 * @package OverSeek
 * @since   2.13.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

class OverSeek_Cart_Recovery
{
	private string $api_url;
	private const RECOVERY_RESULT_SESSION_KEY = 'overseek_recovery_restore_result';

	public function __construct()
	{
		$this->api_url = untrailingslashit((string) get_option('overseek_api_url', ''));
		add_action('template_redirect', [$this, 'maybe_restore_cart'], 1);
		add_action('woocommerce_before_checkout_form', [$this, 'render_restore_notice'], 5);
		add_action('woocommerce_checkout_create_order', [$this, 'attach_recovery_context_to_order'], 10, 2);
	}

	public function maybe_restore_cart(): void
	{
		if (empty($_GET['overseek_recover_cart']) || empty($_GET['overseek_recovery_token'])) {
			return;
		}

		if (!function_exists('WC') || !WC() || !WC()->cart || empty($this->api_url)) {
			return;
		}

		$token = sanitize_text_field(wp_unslash($_GET['overseek_recovery_token']));
		if ($token === '') {
			return;
		}

		$details = $this->fetch_recovery_details($token);
		if (is_wp_error($details)) {
			if (function_exists('wc_add_notice')) {
				wc_add_notice($details->get_error_message(), 'error');
			}
			wp_safe_redirect(function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : home_url('/checkout/'));
			exit;
		}

		$restore_result = $this->restore_cart_items($details['items'] ?? []);
		$this->store_restore_result($restore_result);

		if (($restore_result['restoredCount'] ?? 0) > 0) {
			$this->store_recovery_context($details);
		}

		$redirect_url = !empty($details['checkoutUrl']) ? esc_url_raw((string) $details['checkoutUrl']) : '';
		if ($redirect_url === '') {
			$redirect_url = function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : home_url('/checkout/');
		}

		wp_safe_redirect($redirect_url);
		exit;
	}

	private function fetch_recovery_details(string $token)
	{
		$response = wp_remote_get($this->api_url . '/api/marketing/recover-cart/' . rawurlencode($token) . '/details', [
			'timeout' => 10,
			'headers' => [
				'Accept' => 'application/json',
			],
		]);

		if (is_wp_error($response)) {
			return new WP_Error('overseek_recovery_fetch_failed', 'We could not restore your cart right now. Please try again.');
		}

		$status_code = wp_remote_retrieve_response_code($response);
		$body = json_decode((string) wp_remote_retrieve_body($response), true);

		if ($status_code >= 400 || !is_array($body)) {
			return new WP_Error('overseek_recovery_invalid', 'This recovery link is invalid or has expired.');
		}

		return $body;
	}

	private function restore_cart_items(array $items): array
	{
		$result = [
			'requestedCount' => 0,
			'restoredCount' => 0,
			'failedCount' => 0,
			'missingProductIds' => [],
			'missingVariationIds' => [],
		];

		WC()->cart->empty_cart();

		foreach ($items as $item) {
			if (!is_array($item)) {
				continue;
			}

			$result['requestedCount']++;

			$product_id = isset($item['productId']) ? absint($item['productId']) : absint($item['product_id'] ?? 0);
			$variation_id = isset($item['variationId']) ? absint($item['variationId']) : absint($item['variation_id'] ?? 0);
			$quantity = max(1, absint($item['quantity'] ?? 1));

			if ($product_id <= 0) {
				$result['failedCount']++;
				continue;
			}

			$product = wc_get_product($product_id);
			if (!$product || !$product->exists()) {
				$result['failedCount']++;
				$result['missingProductIds'][] = $product_id;
				continue;
			}

			$variation = [];
			if ($variation_id > 0) {
				$variation_product = wc_get_product($variation_id);
				if (!$variation_product || !$variation_product->exists()) {
					$result['failedCount']++;
					$result['missingVariationIds'][] = $variation_id;
					continue;
				}

				if (method_exists($variation_product, 'get_variation_attributes')) {
					$variation = $variation_product->get_variation_attributes();
				}
			}

			$cart_item_key = WC()->cart->add_to_cart($product_id, $quantity, $variation_id, $variation);
			if ($cart_item_key) {
				$result['restoredCount']++;
				continue;
			}

			$result['failedCount']++;
		}

		WC()->cart->calculate_totals();
		return $result;
	}

	private function store_restore_result(array $restore_result): void
	{
		if (!function_exists('WC') || !WC() || !WC()->session) {
			return;
		}

		WC()->session->set(self::RECOVERY_RESULT_SESSION_KEY, [
			'requestedCount' => absint($restore_result['requestedCount'] ?? 0),
			'restoredCount' => absint($restore_result['restoredCount'] ?? 0),
			'failedCount' => absint($restore_result['failedCount'] ?? 0),
		]);
	}

	public function render_restore_notice(): void
	{
		if (!function_exists('WC') || !WC() || !WC()->session || !function_exists('wc_add_notice')) {
			return;
		}

		$restore_result = WC()->session->get(self::RECOVERY_RESULT_SESSION_KEY);
		if (!is_array($restore_result)) {
			return;
		}

		WC()->session->__unset(self::RECOVERY_RESULT_SESSION_KEY);

		$requested_count = absint($restore_result['requestedCount'] ?? 0);
		$restored_count = absint($restore_result['restoredCount'] ?? 0);
		$failed_count = absint($restore_result['failedCount'] ?? 0);

		if ($requested_count === 0) {
			return;
		}

		if ($restored_count > 0 && $failed_count === 0) {
			wc_add_notice('Your saved cart has been restored. You can complete checkout below.', 'success');
			return;
		}

		if ($restored_count > 0) {
			wc_add_notice(sprintf('We restored %1$d item(s), but %2$d item(s) were unavailable and could not be added back to your cart.', $restored_count, $failed_count), 'notice');
			return;
		}

		wc_add_notice('We could not restore any items from this recovery link. The products may no longer be available.', 'error');
	}

	private function store_recovery_context(array $details): void
	{
		if (!function_exists('WC') || !WC() || !WC()->session) {
			return;
		}

		$context = [
			'enrollmentId' => !empty($details['enrollmentId']) ? sanitize_text_field((string) $details['enrollmentId']) : '',
			'sessionId' => !empty($details['sessionId']) ? sanitize_text_field((string) $details['sessionId']) : '',
			'email' => !empty($details['email']) ? sanitize_email((string) $details['email']) : '',
			'restoredAt' => time(),
		];

		WC()->session->set('overseek_recovery_context', $context);
	}

	public function attach_recovery_context_to_order($order, $data): void
	{
		if (!function_exists('WC') || !WC() || !WC()->session || !is_object($order)) {
			return;
		}

		$context = WC()->session->get('overseek_recovery_context');
		if (!is_array($context) || empty($context['enrollmentId'])) {
			return;
		}

		$order->update_meta_data('_overseek_recovery_enrollment_id', sanitize_text_field((string) $context['enrollmentId']));
		if (!empty($context['sessionId'])) {
			$order->update_meta_data('_overseek_recovery_session_id', sanitize_text_field((string) $context['sessionId']));
		}
		if (!empty($context['email'])) {
			$order->update_meta_data('_overseek_recovery_email', sanitize_email((string) $context['email']));
		}
		$order->update_meta_data('_overseek_recovered_cart', '1');
		$order->update_meta_data('_overseek_recovered_at', gmdate('c'));
	}
}
