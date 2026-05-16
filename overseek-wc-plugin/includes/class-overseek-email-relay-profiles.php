<?php
/**
 * Email Relay Sender Profiles
 *
 * @package OverSeek
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

class OverSeek_Email_Relay_Profiles
{
	private const OPTION_PROFILES = 'overseek_email_relay_profiles';
	private const OPTION_DEFAULT_PROFILE = 'overseek_email_relay_default_profile';

	/**
	 * @var array<string, mixed>|null
	 */
	private static $active_profile = null;

	/**
	 * @var bool
	 */
	private static $hooks_registered = false;

	/**
	 * @var string
	 */
	private static $requested_profile_id = '';

	/**
	 * @var string
	 */
	private static $resolved_profile_id = '';

	/**
	 * @var array<string, string>
	 */
	private static $last_mailer_debug = [];

	public function __construct()
	{
		if (self::$hooks_registered) {
			return;
		}

		add_filter('wp_mail_from', [self::class, 'filter_mail_from'], 9999);
		add_filter('wp_mail_from_name', [self::class, 'filter_mail_from_name'], 9999);
		add_action('phpmailer_init', [self::class, 'configure_phpmailer'], 1);
		add_action('phpmailer_init', [self::class, 'finalize_phpmailer'], 9999);

		self::$hooks_registered = true;
	}

	/**
	 * @param mixed $value
	 */
	public static function sanitize_profiles_option($value): string
	{
		if (!is_string($value) || $value === '') {
			return '';
		}

		$decoded = json_decode(wp_unslash($value), true);
		if (!is_array($decoded)) {
			add_settings_error(self::OPTION_PROFILES, 'invalid_email_profiles_json', 'Email relay sender profiles JSON is invalid.');
			return $value;
		}

		$sanitized_profiles = [];
		foreach ($decoded as $profile) {
			if (!is_array($profile)) {
				continue;
			}

			$id = isset($profile['id']) ? sanitize_key((string) $profile['id']) : '';
			$name = isset($profile['name']) ? sanitize_text_field((string) $profile['name']) : '';
			$from_email = isset($profile['from_email']) ? sanitize_email((string) $profile['from_email']) : '';

			if ($id === '' || $name === '' || $from_email === '' || !is_email($from_email)) {
				continue;
			}

			$smtp_password = isset($profile['smtp_password']) ? sanitize_text_field((string) $profile['smtp_password']) : '';
			$sanitized_profiles[] = [
				'id' => $id,
				'name' => $name,
				'from_name' => isset($profile['from_name']) ? sanitize_text_field((string) $profile['from_name']) : '',
				'from_email' => $from_email,
				'reply_to' => isset($profile['reply_to']) ? sanitize_email((string) $profile['reply_to']) : '',
				'smtp_host' => isset($profile['smtp_host']) ? sanitize_text_field((string) $profile['smtp_host']) : '',
				'smtp_port' => isset($profile['smtp_port']) ? absint((int) $profile['smtp_port']) : 0,
				'smtp_secure' => isset($profile['smtp_secure']) ? sanitize_key((string) $profile['smtp_secure']) : '',
				'smtp_auth' => !empty($profile['smtp_auth']) ? 1 : 0,
				'smtp_username' => isset($profile['smtp_username']) ? sanitize_text_field((string) $profile['smtp_username']) : '',
				'smtp_password' => OverSeek_Crypto_Utils::encrypt_secret($smtp_password),
				'smtp_from_force' => !empty($profile['smtp_from_force']) ? 1 : 0,
			];
		}

		return wp_json_encode($sanitized_profiles) ?: '';
	}

	/**
	 * @param mixed $value
	 */
	public static function sanitize_default_profile_option($value): string
	{
		return sanitize_key((string) $value);
	}

	public static function get_profiles_json_for_admin(): string
	{
		$profiles = self::get_profiles();
		$json = wp_json_encode($profiles, JSON_PRETTY_PRINT);
		return is_string($json) ? $json : '';
	}

	/**
	 * @param array<string, mixed> $payload
	 * @return callable
	 */
	public static function begin_relay_scope(array $payload): callable
	{
		$profile_id = isset($payload['relay_profile_id']) ? sanitize_key((string) $payload['relay_profile_id']) : '';
		self::$requested_profile_id = $profile_id;
		if ($profile_id === '') {
			$profile_id = sanitize_key((string) get_option(self::OPTION_DEFAULT_PROFILE, ''));
		}

		$profile = self::get_profile($profile_id);
		if (!is_array($profile)) {
			self::$active_profile = null;
			self::$resolved_profile_id = '';
			return static function (): void {
				self::$active_profile = null;
				self::$requested_profile_id = '';
				self::$resolved_profile_id = '';
			};
		}

		self::$active_profile = $profile;
		self::$resolved_profile_id = isset($profile['id']) ? (string) $profile['id'] : '';

		return static function (): void {
			self::$active_profile = null;
			self::$requested_profile_id = '';
			self::$resolved_profile_id = '';
		};
	}

	/**
	 * @return array<string, string>
	 */
	public static function get_scope_debug(): array
	{
		$from_email = '';
		$from_name = '';
		if (is_array(self::$active_profile)) {
			$from_email = isset(self::$active_profile['from_email']) ? (string) self::$active_profile['from_email'] : '';
			$from_name = isset(self::$active_profile['from_name']) ? (string) self::$active_profile['from_name'] : '';
		}

		return [
			'requested_profile_id' => self::$requested_profile_id,
			'resolved_profile_id' => self::$resolved_profile_id,
			'from_email' => $from_email,
			'from_name' => $from_name,
		];
	}

	/**
	 * @return array<string, string>
	 */
	public static function get_last_mailer_debug(): array
	{
		return self::$last_mailer_debug;
	}

	/**
	 * @return array<int, array<string, mixed>>
	 */
	private static function get_profiles(): array
	{
		$raw = (string) get_option(self::OPTION_PROFILES, '');
		if ($raw === '') {
			return [];
		}

		$decoded = json_decode($raw, true);
		if (!is_array($decoded)) {
			return [];
		}

		$profiles = [];
		foreach ($decoded as $profile) {
			if (!is_array($profile)) {
				continue;
			}
			if (isset($profile['smtp_password']) && is_string($profile['smtp_password'])) {
				$profile['smtp_password'] = OverSeek_Crypto_Utils::decrypt_secret($profile['smtp_password']);
			}
			$profiles[] = $profile;
		}

		return $profiles;
	}

	/**
	 * @return array<string, mixed>|null
	 */
	private static function get_profile(string $profile_id): ?array
	{
		if ($profile_id === '') {
			return null;
		}

		foreach (self::get_profiles() as $profile) {
			if (is_array($profile) && isset($profile['id']) && (string) $profile['id'] === $profile_id) {
				return $profile;
			}
		}

		return null;
	}

	/**
	 * @param string $default_from
	 */
	public static function filter_mail_from($default_from): string
	{
		if (!is_array(self::$active_profile)) {
			return (string) $default_from;
		}

		$from_email = isset(self::$active_profile['from_email']) ? (string) self::$active_profile['from_email'] : '';
		return is_email($from_email) ? $from_email : (string) $default_from;
	}

	/**
	 * @param string $default_name
	 */
	public static function filter_mail_from_name($default_name): string
	{
		if (!is_array(self::$active_profile)) {
			return (string) $default_name;
		}

		$from_name = isset(self::$active_profile['from_name']) ? (string) self::$active_profile['from_name'] : '';
		return $from_name !== '' ? $from_name : (string) $default_name;
	}

	/**
	 * @param PHPMailer\PHPMailer\PHPMailer $phpmailer
	 */
	public static function configure_phpmailer($phpmailer): void
	{
		if (!is_array(self::$active_profile)) {
			return;
		}

		self::apply_profile_sender($phpmailer, false);

		$smtp_host = isset(self::$active_profile['smtp_host']) ? (string) self::$active_profile['smtp_host'] : '';
		if ($smtp_host === '') {
			return;
		}

		$phpmailer->isSMTP();
		$phpmailer->Host = $smtp_host;
		$phpmailer->Port = isset(self::$active_profile['smtp_port']) ? (int) self::$active_profile['smtp_port'] : 0;
		$phpmailer->SMTPAuth = !empty(self::$active_profile['smtp_auth']);
		$phpmailer->Username = isset(self::$active_profile['smtp_username']) ? (string) self::$active_profile['smtp_username'] : '';
		$phpmailer->Password = isset(self::$active_profile['smtp_password']) ? (string) self::$active_profile['smtp_password'] : '';

		$smtp_secure = isset(self::$active_profile['smtp_secure']) ? (string) self::$active_profile['smtp_secure'] : '';
		if (in_array($smtp_secure, ['ssl', 'tls'], true)) {
			$phpmailer->SMTPSecure = $smtp_secure;
		}

		if (is_email($from_email) && !empty(self::$active_profile['smtp_from_force'])) {
			$phpmailer->setFrom($from_email, $from_name, false);
		}

		$reply_to = isset(self::$active_profile['reply_to']) ? (string) self::$active_profile['reply_to'] : '';
		if (is_email($reply_to)) {
			$phpmailer->clearReplyTos();
			$phpmailer->addReplyTo($reply_to);
		}

		self::capture_mailer_debug($phpmailer);
	}

	/**
	 * Late pass to re-apply sender after other plugins.
	 *
	 * @param PHPMailer\PHPMailer\PHPMailer $phpmailer
	 * @return void
	 */
	public static function finalize_phpmailer($phpmailer): void
	{
		if (!is_array(self::$active_profile)) {
			return;
		}

		self::apply_profile_sender($phpmailer, true);
		self::capture_mailer_debug($phpmailer);
	}

	/**
	 * @param PHPMailer\PHPMailer\PHPMailer $phpmailer
	 */
	private static function apply_profile_sender($phpmailer, bool $force): void
	{
		$from_email = isset(self::$active_profile['from_email']) ? (string) self::$active_profile['from_email'] : '';
		$from_name = isset(self::$active_profile['from_name']) ? (string) self::$active_profile['from_name'] : '';
		if (!is_email($from_email)) {
			return;
		}

		if ($force || !empty(self::$active_profile['smtp_from_force'])) {
			$phpmailer->From = $from_email;
			$phpmailer->FromName = $from_name !== '' ? $from_name : $phpmailer->FromName;
			$phpmailer->Sender = $from_email;
			$phpmailer->setFrom($from_email, $from_name, false);
		}
	}

	/**
	 * @param PHPMailer\PHPMailer\PHPMailer $phpmailer
	 */
	private static function capture_mailer_debug($phpmailer): void
	{
		self::$last_mailer_debug = [
			'mailer' => isset($phpmailer->Mailer) ? (string) $phpmailer->Mailer : '',
			'host' => isset($phpmailer->Host) ? (string) $phpmailer->Host : '',
			'port' => isset($phpmailer->Port) ? (string) $phpmailer->Port : '',
			'secure' => isset($phpmailer->SMTPSecure) ? (string) $phpmailer->SMTPSecure : '',
			'username' => isset($phpmailer->Username) ? (string) $phpmailer->Username : '',
			'from' => isset($phpmailer->From) ? (string) $phpmailer->From : '',
			'from_name' => isset($phpmailer->FromName) ? (string) $phpmailer->FromName : '',
			'sender' => isset($phpmailer->Sender) ? (string) $phpmailer->Sender : '',
		];
	}
}
