<?php
/**
 * Plugin Name: OverSeek Helper
 * Description: Exposes Cart Abandonment data, Visitor Logs, and SMTP Settings to the OverSeek Dashboard.
 * Version: 2.8
 * Author: OverSeek
 */

if (!defined('ABSPATH')) exit;

if (isset($_GET['os_check']) && $_GET['os_check'] === 'die') {
    die('OVERSEEK FILE IS LOADED!');
}

/* -------------------------------------------------------------------------- */
/*                               MAIN CLASS                                   */
/* -------------------------------------------------------------------------- */

if (!class_exists('OverSeek_Helper')) {

    class OverSeek_Helper {

        const DB_VERSION = '2.8';

        public function __construct() {
            // Init
            add_action('init', [$this, 'handle_cors'], 0);
            add_action('rest_api_init', [$this, 'register_routes']);
            add_action('wp_enqueue_scripts', [$this, 'enqueue_chat_widget']);
            add_action('phpmailer_init', [$this, 'configure_smtp']);
            
            // Tracking
            add_action('template_redirect', [$this, 'track_visit']);
            add_action('woocommerce_add_to_cart', [$this, 'log_cart_action'], 10, 6);
            
            // Maintenance
            add_action('admin_init', [$this, 'check_db_version']);
            
            // Direct Request Handler (Legacy/Fallback)
            add_action('wp_loaded', [$this, 'handle_direct_request']);
        }

        /* -------------------------------------------------------------------------- */
        /*                                 SECURITY                                   */
        /* -------------------------------------------------------------------------- */

        public function handle_cors() {
            $uri = $_SERVER['REQUEST_URI'] ?? '';
            $is_relevant = (
                strpos($uri, '/wp-json/overseek/') !== false || 
                strpos($uri, '/wp-json/wc-dash/') !== false || 
                strpos($uri, '/wp-json/woodash/') !== false ||
                strpos($uri, '/wp-json/wc/') !== false ||
                isset($_GET['overseek_direct'])
            );

            if (!$is_relevant) return;

            // Normalize Auth Header
            if (!isset($_SERVER['HTTP_AUTHORIZATION']) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
                $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
            }

            // CORS Headers
            header_remove('Access-Control-Allow-Origin');
            header_remove('Access-Control-Allow-Methods');
            header_remove('Access-Control-Allow-Headers');
            header_remove('Access-Control-Allow-Credentials');

            $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
            $allowed_origins = apply_filters('overseek_allowed_origins', [
                'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'app://.'
            ]);
            
            $is_local = strpos($origin, 'localhost') !== false || strpos($origin, '127.0.0.1') !== false;
            
            if (in_array($origin, $allowed_origins) || $is_local) {
                header("Access-Control-Allow-Origin: $origin");
                header("Access-Control-Allow-Methods: POST, GET, OPTIONS, PUT, DELETE");
                header("Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With, X-WP-Nonce, x-store-url, consumer_key, consumer_secret");
                header("Access-Control-Allow-Credentials: true");
            }

            if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
                status_header(200);
                exit();
            }
        }

        public function auth_check() {
            return current_user_can('manage_woocommerce');
        }

        private function validate_direct_request() {
            if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') return true;

            global $wpdb;
            $key = '';
            
            $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
            if (strpos($auth, 'Basic ') === 0) {
                $creds = base64_decode(substr($auth, 6));
                list($key, $secret) = explode(':', $creds);
            }

            if (!$key && isset($_REQUEST['consumer_key'])) {
                $key = $_REQUEST['consumer_key'];
            }

            if (!$key) return false;

            $key_hash = hash_hmac('sha256', $key, 'wc-api');
            $table = $wpdb->prefix . 'woocommerce_api_keys';
            $row = $wpdb->get_row($wpdb->prepare("SELECT key_id FROM $table WHERE consumer_key = %s LIMIT 1", $key_hash));

            return (bool) $row;
        }

        /* -------------------------------------------------------------------------- */
        /*                             DIRECT HANDLING                                */
        /* -------------------------------------------------------------------------- */

        public function handle_direct_request() {
            if (!isset($_GET['overseek_direct'])) return;

            // Security Check
            if (!$this->validate_direct_request()) {
                http_response_code(401);
                header('Content-Type: application/json');
                echo json_encode(['error' => 'unauthorized', 'message' => 'Invalid or Missing API Credentials']);
                exit;
            }

            $action = $_GET['overseek_direct'];
            header('Content-Type: application/json');

            $data = [];
            switch ($action) {
                case 'status':
                    $data = $this->get_system_status_data();
                    break;
                case 'visitors':
                    $data = $this->get_visitor_count_data();
                    break;
                case 'visitor-log':
                    $data = $this->get_visitor_log_data();
                    break;
                case 'carts':
                    $data = $this->get_carts_data();
                    break;
                case 'smtp':
                    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                        $input = json_decode(file_get_contents('php://input'), true);
                        $data = $this->update_smtp_settings_data($input);
                    } else {
                        $data = $this->get_smtp_settings_data();
                    }
                    break;
                case 'email/send':
                    $input = json_decode(file_get_contents('php://input'), true);
                    $data = $this->send_email_data($input);
                    break;
                case 'install-db':
                    $this->install_db();
                    $data = ['success' => true, 'message' => 'DB Repair Executed'];
                    break;
                default:
                    $data = ['error' => 'unknown_action'];
            }

            echo json_encode($data);
            exit;
        }

        /* -------------------------------------------------------------------------- */
        /*                                REST API                                    */
        /* -------------------------------------------------------------------------- */

        public function register_routes() {
            $namespaces = ['overseek/v1', 'wc-dash/v1', 'woodash/v1'];

            foreach ($namespaces as $ns) {
                register_rest_route($ns, '/status', [
                    'methods' => 'GET',
                    'callback' => function($req) { return rest_ensure_response($this->get_system_status_data()); },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/visitors', [
                    'methods' => 'GET',
                    'callback' => function($req) { return rest_ensure_response($this->get_visitor_count_data()); },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/visitor-log', [
                    'methods' => 'GET',
                    'callback' => function($req) { return rest_ensure_response($this->get_visitor_log_data()); },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/carts', [
                    'methods' => 'GET',
                    'callback' => function($req) { return rest_ensure_response($this->get_carts_data()); },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/settings/smtp', [
                    'methods' => ['GET', 'POST'],
                    'callback' => function($req) {
                        return $req->get_method() === 'POST' 
                            ? rest_ensure_response($this->update_smtp_settings_data($req->get_params()))
                            : rest_ensure_response($this->get_smtp_settings_data());
                    },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/settings/chat', [
                    'methods' => ['GET', 'POST'],
                    'callback' => function($req) {
                        return $req->get_method() === 'POST'
                            ? rest_ensure_response($this->update_chat_settings_data($req->get_params()))
                            : rest_ensure_response($this->get_chat_settings_data());
                    },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/email/send', [
                    'methods' => 'POST',
                    'callback' => function($req) { return rest_ensure_response($this->send_email_data($req->get_params())); },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/install-db', [
                    'methods' => 'POST',
                    'callback' => function($req) { 
                        $this->install_db(); 
                        return rest_ensure_response(['success' => true, 'message' => 'Database repair attempted']); 
                    },
                    'permission_callback' => [$this, 'auth_check']
                ]);

                register_rest_route($ns, '/test-visit', [
                    'methods' => 'POST',
                    'callback' => [$this, 'create_test_visit'],
                    'permission_callback' => [$this, 'auth_check']
                ]);
            }
        }

        /* -------------------------------------------------------------------------- */
        /*                               CORE LOGIC                                   */
        /* -------------------------------------------------------------------------- */

        public function get_system_status_data() {
            global $wpdb;
            $table_name = $wpdb->prefix . 'overseek_visits';
            // Simple check using options is faster than SHOW TABLES
            $db_version = get_option('overseek_db_version', '0');
            
            return [
                'plugin_name' => 'OverSeek Helper',
                'version' => '2.8.0',
                'namespace' => 'overseek/v1',
                'db_version' => $db_version,
                'wp_version' => get_bloginfo('version'),
                'wc_version' => class_exists('WooCommerce') ? WC()->version : 'Unknown',
                'server' => $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown',
                'php_version' => phpversion()
            ];
        }

        public function get_visitor_count_data() {
            global $wpdb;
            $table_name = $wpdb->prefix . 'overseek_visits';
            // Add error suppression for when table doesn't exist
            $count = $wpdb->get_var("SELECT COUNT(*) FROM $table_name WHERE last_activity > DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
            return ['count' => (int) $count];
        }

        public function get_visitor_log_data() {
            global $wpdb;
            $table_name = $wpdb->prefix . 'overseek_visits';
            $visits = $wpdb->get_results("SELECT * FROM $table_name ORDER BY last_activity DESC LIMIT 50");
            return $visits ?: [];
        }

        public function get_carts_data() {
            global $wpdb;
            $table_name = $wpdb->prefix . 'woocommerce_sessions';
            $results = $wpdb->get_results("SELECT * FROM $table_name ORDER BY session_expiry DESC LIMIT 50");
            
            $carts = [];
            foreach ($results as $session) {
                $data = maybe_unserialize($session->session_value);
                if (!isset($data['cart']) || empty($data['cart'])) continue;
                
                $cart_data = maybe_unserialize($data['cart']);
                $items = [];
                $total = 0;
                
                if (is_array($cart_data)) {
                    foreach ($cart_data as $item) {
                        $total += $item['line_total'] ?? 0;
                        $items[] = [
                            'name' => get_the_title($item['product_id']),
                            'qty' => $item['quantity'] ?? 1
                        ];
                    }
                }

                // Extract Customer
                $customer = ['first_name' => 'Guest', 'last_name' => '', 'email' => '', 'id' => 0];
                if (is_numeric($session->session_key)) {
                    $user = get_userdata($session->session_key);
                    if ($user) {
                        $customer = [
                            'first_name' => $user->first_name ?: $user->display_name,
                            'last_name' => $user->last_name,
                            'email' => $user->user_email,
                            'id' => $user->ID
                        ];
                    }
                } elseif (isset($data['customer']) && !empty($data['customer'])) {
                    $c = maybe_unserialize($data['customer']);
                    $customer['first_name'] = $c['first_name'] ?? 'Guest';
                    $customer['last_name'] = $c['last_name'] ?? '';
                    $customer['email'] = $c['email'] ?? ($c['billing_email'] ?? '');
                }

                $carts[] = [
                    'session_key' => $session->session_key,
                    'total' => $total,
                    'items' => $items,
                    'customer' => $customer,
                    'last_update' => date('Y-m-d H:i:s', $session->session_expiry)
                ];
            }
            return $carts;
        }

        public function get_smtp_settings_data() {
            return get_option('overseek_smtp_settings', []);
        }

        public function update_smtp_settings_data($settings) {
            if ($settings) {
                update_option('overseek_smtp_settings', $settings);
                return ['success' => true];
            }
            return ['success' => false, 'error' => 'invalid_data'];
        }

        public function get_chat_settings_data() {
            return get_option('overseek_chat_settings', []);
        }

        public function update_chat_settings_data($settings) {
            if ($settings) {
                update_option('overseek_chat_settings', $settings);
                return ['success' => true];
            }
            return ['success' => false, 'error' => 'invalid_data'];
        }

        public function enqueue_chat_widget() {
             // Load Chat Config
             $config = get_option('overseek_chat_settings', []);
             
             if (empty($config) || empty($config['chatEnabled'])) return;
             
             // Enqueue JS
             // Assuming the JS file is in an 'assets' folder relative to this plugin file
             $url = plugin_dir_url(__FILE__) . 'assets/overseek-chat.js';
             // Version based on file time for cache busting
             $ver = file_exists(plugin_dir_path(__FILE__) . 'assets/overseek-chat.js') 
                  ? filemtime(plugin_dir_path(__FILE__) . 'assets/overseek-chat.js') 
                  : '1.0';

             wp_enqueue_script('overseek-chat', $url, [], $ver, true);
             
             // Pass Config
             wp_localize_script('overseek-chat', 'overseekChatConfig', [
                 'enabled' => $config['chatEnabled'],
                 'businessHours' => $config['businessHours'] ?? [],
                 'timezone' => $config['timeZone'] ?? '', // Fallback to WP? get_option('timezone_string')
                 'offlineBehavior' => $config['offlineBehavior'] ?? 'hide',
                 'offlineMessage' => $config['offlineMessage'] ?? '',
                 'styles' => [
                     'primaryColor' => $config['primaryColor'] ?? '#6366f1',
                     'position' => $config['position'] ?? 'right'
                 ]
             ]);
        }

        public function send_email_data($input) {
            if (!$input || !isset($input['to'])) return ['success' => false, 'error' => 'missing_recipient'];
            
            // Rate Limit Check
            $smtp = get_option('overseek_smtp_settings', []);
            $max_rate = isset($smtp['max_rate']) ? (int)$smtp['max_rate'] : 0;

            if ($max_rate > 0) {
                // Fixed Bucket Strategy
                $bucket = get_transient('overseek_email_throttle');
                
                // If bucket is missing or expired (though get_transient handles expiration, manual check is safer for logic)
                if (!$bucket || !isset($bucket['reset_time']) || $bucket['reset_time'] < time()) {
                    $bucket = ['count' => 0, 'reset_time' => time() + 60];
                }

                if ($bucket['count'] >= $max_rate) {
                    return ['success' => false, 'error' => 'rate_limit_exceeded', 'message' => "Email rate limit of {$max_rate}/min reached."];
                }

                $bucket['count']++;
                // Save back. 60 seconds TTL is close enough
                set_transient('overseek_email_throttle', $bucket, 60);
            }

            $to = sanitize_email($input['to']);
            $subject = sanitize_text_field($input['subject'] ?? 'No Subject');
            $message = wp_kses_post($input['message'] ?? '');
            
            $sent = wp_mail($to, $subject, $message, ['Content-Type: text/html; charset=UTF-8']);
            return ['success' => $sent];
        }

        /* -------------------------------------------------------------------------- */
        /*                           VISITOR TRACKING                                 */
        /* -------------------------------------------------------------------------- */

        public function check_db_version() {
            if (get_option('overseek_db_version') !== self::DB_VERSION) {
                $this->install_db();
            }
        }

        public function install_db() {
            global $wpdb;
            $table_name = $wpdb->prefix . 'overseek_visits';
            $charset_collate = $wpdb->get_charset_collate();

            $sql = "CREATE TABLE IF NOT EXISTS $table_name (
                id mediumint(9) NOT NULL AUTO_INCREMENT,
                visit_id varchar(50) NOT NULL, 
                start_time datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
                last_activity datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
                ip varchar(100) NOT NULL,
                customer_id mediumint(9) DEFAULT 0,
                referrer text,
                device_info text, 
                actions longtext, 
                PRIMARY KEY  (id),
                UNIQUE KEY visit_id (visit_id),
                INDEX last_activity (last_activity)
            ) $charset_collate;";

            require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
            dbDelta($sql);
            update_option('overseek_db_version', self::DB_VERSION);
        }

        public function create_test_visit() {
            global $wpdb;
            $table_name = $wpdb->prefix . 'overseek_visits';
            
            // Random IP to simulate different users
            $ip = '192.168.1.' . rand(1, 255);
            $visit_id = 'test_' . uniqid();
            $time = current_time('mysql');
            
            $referrers = ['https://google.com', 'https://facebook.com', 'https://twitter.com', 'Direct'];
            $ref = $referrers[array_rand($referrers)];

            $devices = [
                ['ua' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'is_mobile' => false, 'os' => 'Windows', 'browser' => 'Chrome'],
                ['ua' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)', 'is_mobile' => true, 'os' => 'iOS', 'browser' => 'Safari'],
            ];
            $device = $devices[array_rand($devices)];

            $actions = [
                ['type' => 'page_view', 'url' => home_url('/'), 'title' => 'Home Page', 'time' => time() - 120],
                ['type' => 'page_view', 'url' => home_url('/shop/'), 'title' => 'Shop', 'time' => time() - 60],
                ['type' => 'add_to_cart', 'url' => home_url('/product/test/'), 'title' => 'Test Product', 'name' => 'Test Product', 'qty' => 1, 'time' => time()]
            ];

            $wpdb->insert($table_name, [
                'visit_id' => $visit_id,
                'start_time' => $time,
                'last_activity' => $time,
                'ip' => $ip,
                'customer_id' => 0,
                'referrer' => $ref,
                'device_info' => json_encode($device),
                'actions' => json_encode($actions)
            ]);

            return ['success' => true, 'visit_id' => $visit_id];
        }

        public function track_visit() {
            // Performance Guards
            if (defined('REST_REQUEST') || is_admin() || is_feed() || is_trackback()) return;
            if (current_user_can('manage_options') || current_user_can('manage_woocommerce')) return;
            if ($this->is_bot()) return;

            // Simple check to ensure DB is ready (cached option)
            if (get_option('overseek_db_version') !== self::DB_VERSION) return;

            global $wpdb;
            $table_name = $wpdb->prefix . 'overseek_visits';
            $cookie_name = 'overseek_vid';
            $is_new_visit = false;
            $visit_id = '';

            if (isset($_COOKIE[$cookie_name])) {
                $visit_id = sanitize_key($_COOKIE[$cookie_name]);
            } else {
                $visit_id = 'fp_' . md5(($_SERVER['REMOTE_ADDR'] ?? '') . ($_SERVER['HTTP_USER_AGENT'] ?? '') . date('Y-m-d'));
                $is_new_visit = true;
            }
            // Refresh cookie
            // setcookie not working reliably in some WP headers flows, but nice to try
            // Note: In late hooks headers might be sent. template_redirect matches fine.
            if (!headers_sent()) {
                setcookie($cookie_name, $visit_id, time() + 1800, '/');
            }

            $current_url = (is_ssl() ? 'https' : 'http') . "://" . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '');
            
            // Upsert Logic (Raw SQL for speed)
            // Use ON DUPLICATE KEY UPDATE to avoid select-then-update round trips
            $user_id = get_current_user_id();
            $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
            $time = current_time('mysql');
            $ref = $_SERVER['HTTP_REFERER'] ?? '';
            
            // We append actions. This is complex in pure SQL.
            // Fallback to Select-Update for JSON manipulation, but minimal.
            
            $existing = $wpdb->get_row($wpdb->prepare("SELECT id, actions FROM $table_name WHERE visit_id = %s", $visit_id));
            
            $new_action = [
                'type' => 'page_view',
                'url' => $current_url,
                'title' => wp_get_document_title(),
                'time' => time()
            ];

            if ($existing) {
                // Determine if we should update. Only update if last activity > 5 sec ago to prevent flood?
                // For now, simple append.
                $actions = json_decode($existing->actions, true) ?: [];
                $actions[] = $new_action;
                // Truncate actions if too long?
                if (count($actions) > 50) array_shift($actions);

                $wpdb->update($table_name, [
                    'actions' => json_encode($actions),
                    'last_activity' => $time
                ], ['id' => $existing->id]);
            } else {
                $device = [
                    'ua' => $_SERVER['HTTP_USER_AGENT'] ?? '',
                    'is_mobile' => wp_is_mobile()
                ];

                $wpdb->insert($table_name, [
                    'visit_id' => $visit_id,
                    'start_time' => $time,
                    'last_activity' => $time,
                    'ip' => $ip,
                    'customer_id' => $user_id,
                    'referrer' => $ref,
                    'device_info' => json_encode($device),
                    'actions' => json_encode([$new_action])
                ]);
            }
        }

        public function log_cart_action($cart_item_key, $product_id, $quantity, $variation_id, $variation, $cart_item_data) {
            // Can be enhanced to log specific event to visitor log
            // For now, just ensure visit is tracked
            $this->track_visit();
        }

        public function configure_smtp($phpmailer) {
            $smtp = get_option('overseek_smtp_settings', []);
            if (!empty($smtp['enabled']) && $smtp['enabled'] === 'yes') {
                $phpmailer->isSMTP();
                $phpmailer->Host = $smtp['host'];
                $phpmailer->SMTPAuth = true;
                $phpmailer->Port = $smtp['port'];
                $phpmailer->Username = $smtp['username'];
                $phpmailer->Password = $smtp['password'];
                $phpmailer->SMTPSecure = $smtp['encryption']; 
                $phpmailer->From = $smtp['from_email'];
                $phpmailer->FromName = $smtp['from_name'];
            }
        }

        private function is_bot() {
            if (!isset($_SERVER['HTTP_USER_AGENT'])) return true;
            $ua = strtolower($_SERVER['HTTP_USER_AGENT']);
            return (strpos($ua, 'bot') !== false || strpos($ua, 'crawl') !== false || strpos($ua, 'slurp') !== false || strpos($ua, 'spider') !== false);
        }
    }

    // Instantiate
    new OverSeek_Helper();
}
