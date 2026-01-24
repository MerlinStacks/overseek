<?php
/**
 * Frontend Script Injection Handler
 *
 * @package OverSeek
 * @since   1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Class OverSeek_Frontend
 *
 * Handles frontend script injection based on settings.
 * Analytics tracking is 100% server-side via class-overseek-server-tracking.php.
 * This class handles the optional Live Chat widget only.
 *
 * @since 1.0.0
 */
class OverSeek_Frontend
{
	/**
	 * Print scripts to the head if chat is enabled and within business hours.
	 * Analytics is handled server-side - no JavaScript needed.
	 *
	 * @return void
	 */
	public function print_scripts(): void
	{
		$chat_enabled = get_option('overseek_enable_chat');
		$api_url = get_option('overseek_api_url', '');
		$account_id = get_option('overseek_account_id');

		// Early exit if chat not configured.
		if (!$chat_enabled || empty($account_id)) {
			return;
		}

		// Server-side business hours check - don't load widget outside hours.
		if (!$this->is_within_business_hours($api_url, $account_id)) {
			return;
		}

		$api_url = untrailingslashit($api_url);

		// Output chat widget script with modern loading attributes.
		echo "<!-- OverSeek Live Chat Widget v" . esc_html(OVERSEEK_WC_VERSION) . " -->\n";
		printf(
			'<script src="%s/api/chat/widget.js?id=%s&v=%s" defer async crossorigin="anonymous"></script>%s',
			esc_url($api_url),
			esc_attr($account_id),
			esc_attr(OVERSEEK_WC_VERSION),
			PHP_EOL
		);
		echo "<!-- OverSeek Live Chat Widget End -->\n";
	}

	/**
	 * Check if current time is within configured business hours.
	 * Fetches config from OverSeek API and caches for 5 minutes.
	 *
	 * @param string $api_url    The OverSeek API URL.
	 * @param string $account_id The account identifier.
	 * @return bool True if within business hours or hours not configured.
	 */
	private function is_within_business_hours(string $api_url, string $account_id): bool
	{
		$config = $this->get_chat_config($api_url, $account_id);

		// If no business hours configured, always show chat.
		if (empty($config['businessHours']['enabled'])) {
			return true;
		}

		$business_hours = $config['businessHours'];
		$timezone = $config['businessTimezone'] ?? 'Australia/Sydney';

		try {
			$tz = new DateTimeZone($timezone);
			$now = new DateTime('now', $tz);

			$day_map = ['Sun' => 'sun', 'Mon' => 'mon', 'Tue' => 'tue', 'Wed' => 'wed', 'Thu' => 'thu', 'Fri' => 'fri', 'Sat' => 'sat'];
			$weekday = $day_map[$now->format('D')] ?? '';

			if (empty($business_hours['days'][$weekday])) {
				return false;
			}

			$schedule = $business_hours['days'][$weekday];

			if (empty($schedule['isOpen'])) {
				return false;
			}

			$current_minutes = (int) $now->format('H') * 60 + (int) $now->format('i');

			[$open_h, $open_m] = array_map('intval', explode(':', $schedule['open'] ?? '09:00'));
			[$close_h, $close_m] = array_map('intval', explode(':', $schedule['close'] ?? '17:00'));

			$open_minutes = $open_h * 60 + $open_m;
			$close_minutes = $close_h * 60 + $close_m;

			return $current_minutes >= $open_minutes && $current_minutes <= $close_minutes;
		} catch (Exception $e) {
			// Fail open - show chat if timezone parsing fails.
			return true;
		}
	}

	/**
	 * Get chat configuration from OverSeek API with transient caching.
	 *
	 * @param string $api_url    The OverSeek API URL.
	 * @param string $account_id The account identifier.
	 * @return array<string, mixed> Chat configuration array.
	 */
	private function get_chat_config(string $api_url, string $account_id): array
	{
		$transient_key = 'overseek_chat_config_' . md5($account_id);
		$cached = get_transient($transient_key);

		if ($cached !== false && is_array($cached)) {
			return $cached;
		}

		$api_url = untrailingslashit($api_url);
		$response = wp_remote_get(
			$api_url . '/api/chat/config/' . $account_id,
			[
				'timeout' => 3,
				'headers' => ['Accept' => 'application/json'],
			]
		);

		if (is_wp_error($response)) {
			// On error, return empty config (fail open).
			return [];
		}

		$body = wp_remote_retrieve_body($response);
		$data = json_decode($body, true);

		if (!is_array($data)) {
			return [];
		}

		// Cache for 5 minutes to reduce API calls.
		set_transient($transient_key, $data, 5 * MINUTE_IN_SECONDS);

		return $data;
	}
}


