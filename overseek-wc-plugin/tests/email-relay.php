<?php
/** Isolated relay MIME/header contracts; no live email is sent. */
declare(strict_types=1);
define('ABSPATH', __DIR__);
$hooks = [];
$throw_on_send = false;
function sanitize_email($value) { return $value; }
function sanitize_text_field($value) { return trim($value); }
function is_email($value) { return filter_var($value, FILTER_VALIDATE_EMAIL); }
function home_url() { return 'https://shop.test'; }
function wp_parse_url($url, $component) { return parse_url($url, $component); }
function add_action($hook, $callback, $priority = 10) { $GLOBALS['hooks'][$hook][$priority][] = $callback; }
function remove_action($hook, $callback, $priority = 10) {
    $GLOBALS['hooks'][$hook][$priority] = array_filter($GLOBALS['hooks'][$hook][$priority], fn($item) => $item !== $callback);
}
function wp_mail($to, $subject, $html, $headers, $attachments) {
    $mailer = (object) ['AltBody' => '', 'MessageID' => '<message-123@shop.test>'];
    foreach ($GLOBALS['hooks']['phpmailer_init'] ?? [] as $callbacks) {
        foreach ($callbacks as $callback) { $callback($mailer); }
    }
    $GLOBALS['mailer_instance'] = $mailer;
    $GLOBALS['sent'] = ['mailer' => clone $mailer, 'headers' => $headers];
    if ($GLOBALS['throw_on_send']) { throw new RuntimeException('SMTP error'); }
    return true;
}
class WP_REST_Request {
    public function __construct(private array $params) {}
    public function get_json_params() { return $this->params; }
}
class WP_REST_Response {
    public function __construct(public array $data, public int $status) {}
}
require __DIR__ . '/../includes/class-overseek-api.php';
function check($condition, $message) { if (!$condition) { throw new RuntimeException($message); } }
$api = new OverSeek_API();
$base = ['to' => 'customer@example.com', 'subject' => 'Hello', 'html' => '<html><body>Hello</body></html>', 'text' => 'Hello'];
$marketing = $base + ['list_unsubscribe' => 'https://api.test/unsubscribe/token', 'list_unsubscribe_post' => 'List-Unsubscribe=One-Click'];
$response = $api->email_relay_callback(new WP_REST_Request($marketing));
check($response->status === 200, 'Marketing mail accepted');
check($sent['mailer']->AltBody === 'Hello', 'Plain-text alternative reaches PHPMailer');
check($sent['mailer']->MessageID === $response->data['message_id'], 'Returned message ID matches sent message');
check($sent['mailer']->MessageID !== '<message-123@shop.test>', 'Use a unique RFC message ID');
check(in_array('List-Unsubscribe: <https://api.test/unsubscribe/token>', $sent['headers'], true), 'Unsubscribe header preserved');
check(in_array('List-Unsubscribe-Post: List-Unsubscribe=One-Click', $sent['headers'], true), 'One-click header preserved');
check(empty($hooks['phpmailer_init'][PHP_INT_MAX]), 'Hook removed after sending');
check($mailer_instance->AltBody === '', 'Plain text does not leak into subsequent WordPress mail');
$api->email_relay_callback(new WP_REST_Request($base));
check(!preg_grep('/^List-Unsubscribe/', $sent['headers']), 'Transactional send has no marketing headers');
$response = $api->email_relay_callback(new WP_REST_Request(array_merge($marketing, ['list_unsubscribe' => "https://api.test/\r\nBcc: attacker@example.com"])));
check($response->status === 400, 'Reject header injection');
$throw_on_send = true;
try { $api->email_relay_callback(new WP_REST_Request($base)); } catch (RuntimeException $error) {
    check($error->getMessage() === 'SMTP error', 'Original send failure preserved');
}
check(empty($hooks['phpmailer_init'][PHP_INT_MAX]), 'Hook removed after exceptions');
check($mailer_instance->AltBody === '', 'Plain text restored after exceptions');
echo "Email relay contracts passed\n";
