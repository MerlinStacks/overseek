<?php
/**
 * Plugin Name: OverSeek Helper
 * Description: Exposes Cart Abandonment data, Visitor Logs, and SMTP Settings to the OverSeek Dashboard.
 * Version: 2.7
 */

if (!defined('ABSPATH')) exit;

if (isset($_GET['os_check']) && $_GET['os_check'] === 'die') {
    die('OVERSEEK FILE IS LOADED! Global Scope.');
}

add_action('wp_loaded', function() {
    if (!isset($_GET['overseek_direct'])) return;

    if (!isset($_SERVER['HTTP_AUTHORIZATION']) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }

    $action = $_GET['overseek_direct'];
    global $wpdb;

    if (!function_exists('os_validate_direct_auth')) {
        function os_validate_direct_auth() {
            global $wpdb;

            $key = '';
            $secret = '';

            $auth = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
            if (!$auth) {
                if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
                    $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
                }
            }

            if ($auth && strpos($auth, 'Basic ') === 0) {
                $creds = base64_decode(substr($auth, 6));
                list($key, $secret) = explode(':', $creds);
            }

            if (!$key && isset($_REQUEST['consumer_key'])) {
                $key = $_REQUEST['consumer_key'];
            }

            if (!$key) return false;

            $key_hash = hash_hmac('sha256', $key, 'wc-api');

            $table = $wpdb->prefix . 'woocommerce_api_keys';
            
            $row = $wpdb->get_row($wpdb->prepare("SELECT key_id, permissions FROM $table WHERE consumer_key = %s LIMIT 1", $key_hash));

            return (bool) $row;
        }
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'OPTIONS') {
        if (!os_validate_direct_auth()) {
             http_response_code(401);
             header('Content-Type: application/json');
             header('Access-Control-Allow-Origin: *'); 
             echo json_encode(['error' => 'unauthorized', 'message' => 'Invalid or Missing API Credentials']);
             exit;
        }
    }

    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, x-store-url, X-WP-Nonce');
    header('Content-Type: application/json');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

    if ($action === 'status') {
         $table_name = $wpdb->prefix . 'overseek_visits';
         $exists = $wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name;
         echo json_encode([
             'status' => 'ok', 
             'type' => 'direct_wp_loaded_secure', 
             'db_version' => get_option('overseek_db_version'),
             'table_exists' => $exists,
             'wc_version' => class_exists('WooCommerce') ? WC()->version : 'Unknown'
         ]);
         exit;
    }
    
    if ($action === 'visitors') {
        $table_name = $wpdb->prefix . 'overseek_visits';
        if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") != $table_name) {
            echo json_encode(['count' => 0, 'error' => 'no_table']);
        } else {
            $count = $wpdb->get_var("SELECT COUNT(*) FROM $table_name WHERE last_activity > DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
            echo json_encode(['count' => (int)$count]);
        }
        exit;
    }

    if ($action === 'visitor-log') {
        $table_name = $wpdb->prefix . 'overseek_visits';
        if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name) {
            $visits = $wpdb->get_results("SELECT * FROM $table_name ORDER BY last_activity DESC LIMIT 50");
            echo json_encode($visits);
        } else {
            echo json_encode([]);
        }
        exit;
    }

    if ($action === 'carts') {
        $table_name = $wpdb->prefix . 'woocommerce_sessions';
        if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name) {
            $sessions = $wpdb->get_results("SELECT * FROM $table_name ORDER BY session_expiry DESC LIMIT 50");
            $carts = [];
            foreach ($sessions as $session) {
                $data = is_serialized($session->session_value) ? unserialize($session->session_value) : $session->session_value;
                
                if (!isset($data['cart']) || empty($data['cart'])) continue;
                $cart_data = is_serialized($data['cart']) ? unserialize($data['cart']) : $data['cart'];
                
                $items = [];
                $total = 0;
                if (is_array($cart_data)) {
                    foreach ($cart_data as $item) {
                        $total += isset($item['line_total']) ? $item['line_total'] : 0;
                        $product_name = get_the_title($item['product_id']);
                        $items[] = [
                            'name' => $product_name ? $product_name : 'Product #' . $item['product_id'],
                            'qty' => isset($item['quantity']) ? $item['quantity'] : 1
                        ];
                    }
                }
                
                $customer = ['first_name' => 'Guest', 'last_name' => '', 'email' => '', 'id' => 0];
                
                if (is_numeric($session->session_key)) {
                    $user = get_userdata($session->session_key);
                    if ($user) {
                        $customer['first_name'] = $user->first_name ?: $user->display_name;
                        $customer['last_name'] = $user->last_name;
                        $customer['email'] = $user->user_email;
                        $customer['id'] = $user->ID;
                    }
                } 
                else {
                     if (isset($data['customer']) && !empty($data['customer'])) {
                         $cust_data = is_serialized($data['customer']) ? unserialize($data['customer']) : $data['customer'];
                         
                         if (isset($cust_data['first_name'])) $customer['first_name'] = $cust_data['first_name'];
                         if (isset($cust_data['last_name'])) $customer['last_name'] = $cust_data['last_name'];
                         if (isset($cust_data['email'])) $customer['email'] = $cust_data['email'];
                         if (isset($cust_data['billing_email'])) $customer['email'] = $cust_data['billing_email'];
                     }
                }

                $carts[] = [
                    'session_key' => $session->session_key,
                    'total' => $total,
                    'items' => $items,
                    'customer' => $customer,
                    'last_update' => date('Y-m-d H:i:s', $session->session_expiry)
                ];
            }
            echo json_encode($carts);
        } else {
             echo json_encode([]);
        }
        exit;
    }

    if ($action === 'email/send') {
        $input = json_decode(file_get_contents('php://input'), true);
        if ($input && function_exists('wp_mail')) {
            $to = sanitize_email($input['to']);
            $subject = sanitize_text_field($input['subject']);
            $message = wp_kses_post($input['message']);
            
            add_action('phpmailer_init', function($phpmailer) {
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
            });
            
            $sent = wp_mail($to, $subject, $message, ['Content-Type: text/html; charset=UTF-8']);
            echo json_encode(['success' => $sent]);
        } else {
            echo json_encode(['success' => false, 'error' => 'invalid_input_or_wp_mail_error']);
        }
        exit;
    }

    if ($action === 'smtp') {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $input = json_decode(file_get_contents('php://input'), true);
            if ($input) {
                update_option('overseek_smtp_settings', $input);
                echo json_encode(['success' => true]);
            } else {
                echo json_encode(['success' => false, 'error' => 'invalid_json']);
            }
        } else {
            echo json_encode(get_option('overseek_smtp_settings', []));
        }
        exit;
    }

    if ($action === 'install-db') {
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
            UNIQUE KEY visit_id (visit_id)
        ) $charset_collate;";
        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
        update_option('overseek_db_version', '2.5');
        echo json_encode(['success' => true, 'message' => 'DB Repair Executed']);
        exit;
    }
});

if (class_exists('OverSeek_Helper_Latest')) {
    return;
}

class OverSeek_Helper_Latest {

    public function __construct() {
        add_action('init', [$this, 'handle_cors'], 0);
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action('phpmailer_init', [$this, 'configure_smtp']);
        add_action('template_redirect', [$this, 'track_visit']);
        add_action('init', [$this, 'handle_direct_request']); // Fallback
        
        add_action('admin_init', [$this, 'install_db_v2']);
        add_action('woocommerce_add_to_cart', [$this, 'log_cart_action'], 10, 6);
        add_action('woocommerce_thankyou', [$this, 'log_order_action'], 10, 1);
    }

    public function handle_cors() {
        $uri = $_SERVER['REQUEST_URI'];
        $is_relevant_route = (
            strpos($uri, '/wp-json/overseek/') !== false || 
            strpos($uri, '/wp-json/wc-dash/') !== false || 
            strpos($uri, '/wp-json/woodash/') !== false ||
            strpos($uri, '/wp-json/wc/') !== false
        );

        if (!$is_relevant_route) return;

        if (!isset($_SERVER['HTTP_AUTHORIZATION'])) {
            if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
                $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
            }
        }

        header_remove('Access-Control-Allow-Origin');
        header_remove('Access-Control-Allow-Methods');
        header_remove('Access-Control-Allow-Headers');
        header_remove('Access-Control-Allow-Credentials');

        $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
        $allowed_origins = apply_filters('overseek_allowed_origins', [
            'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'app://.' 
        ]);
        
        $allow_origin = null;
        $is_local = strpos($origin, 'localhost') !== false || strpos($origin, '127.0.0.1') !== false;
        
        if (in_array($origin, $allowed_origins) || $is_local) {
            $allow_origin = $origin;
        }

        if ($allow_origin) {
            header("Access-Control-Allow-Origin: $allow_origin");
            header("Access-Control-Allow-Methods: POST, GET, OPTIONS, PUT, DELETE");
            header("Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With, X-WP-Nonce, x-store-url");
            header("Access-Control-Allow-Credentials: true");
        }

        if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
            status_header(200);
            exit();
        }
    }

    public function install_db_v2() {
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
            UNIQUE KEY visit_id (visit_id)
        ) $charset_collate;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);

        update_option('overseek_db_version', '2.5');
        return true;
    }

    public function api_install_db() {
        $this->install_db_v2();
        return rest_ensure_response(['success' => true, 'message' => 'Database repair attempted']);
    }

    public function register_routes() {
        $namespaces = ['overseek/v1', 'wc-dash/v1', 'woodash/v1'];

        foreach ($namespaces as $ns) {
            register_rest_route($ns, '/install-db', [
                'methods' => 'POST',
                'callback' => [$this, 'api_install_db'], 
                'permission_callback' => [$this, 'auth_check']
            ]);
            
            register_rest_route($ns, '/test-visit', [
                'methods' => 'POST',
                'callback' => [$this, 'create_test_visit'],
                'permission_callback' => [$this, 'auth_check']
            ]);

            register_rest_route($ns, '/status', [
                'methods' => 'GET',
                'callback' => [$this, 'get_system_status'],
                'permission_callback' => [$this, 'auth_check']
            ]);

            register_rest_route($ns, '/carts', [
                'methods' => 'GET',
                'callback' => [$this, 'get_carts'],
                'permission_callback' => [$this, 'auth_check']
            ]);

            register_rest_route($ns, '/email/send', [
                'methods' => 'POST',
                'callback' => [$this, 'send_email'],
                'permission_callback' => [$this, 'auth_check']
            ]);

            register_rest_route($ns, '/settings/smtp', [
                'methods' => 'GET',
                'callback' => [$this, 'get_smtp_settings'],
                'permission_callback' => [$this, 'auth_check']
            ]);
            
            register_rest_route($ns, '/settings/smtp', [
                'methods' => 'POST',
                'callback' => [$this, 'update_smtp_settings'],
                'permission_callback' => [$this, 'auth_check']
            ]);
            
            register_rest_route($ns, '/visitor-log', [
                'methods' => 'GET',
                'callback' => [$this, 'get_visitor_log'],
                'permission_callback' => [$this, 'auth_check']
            ]);
            
            register_rest_route($ns, '/visitors', [
                'methods' => 'GET',
                'callback' => [$this, 'get_visitor_count'],
                'permission_callback' => [$this, 'auth_check']
            ]);
        }
    }
    
    public function handle_direct_request() {
        if (!isset($_GET['overseek_direct'])) return;

        $action = $_GET['overseek_direct'];
        header('Access-Control-Allow-Origin: *');
        header('Content-Type: application/json');

        if ($action === 'status') {
             echo json_encode([
                 'status' => 'ok', 
                 'method' => 'direct_bypass_class', // Different tag for debugging
                 'plugin_version' => '2.7'
             ]);
             exit;
        }
    }
    
    public function auth_check() {
        return current_user_can('manage_woocommerce');
    }

    public function create_test_visit() {
        $this->update_visit_log('test_' . time(), [
            'type' => 'page_view',
            'url' => 'http://test.com',
            'title' => 'Test Visit Triggered Manually',
            'time' => time()
        ], true);
        return rest_ensure_response(['success' => true]);
    }

    public function track_visit() {
        if (defined('REST_REQUEST')) return;
        if (is_admin() || current_user_can('manage_options') || current_user_can('manage_woocommerce')) return; 
        if (is_robots() || is_feed() || is_trackback() || $this->is_bot()) return;

        $cookie_name = 'overseek_vid';
        $visit_id = '';
        $is_new_visit = false;

        if (isset($_COOKIE[$cookie_name])) {
            $visit_id = sanitize_key($_COOKIE[$cookie_name]);
            setcookie($cookie_name, $visit_id, time() + 1800, '/');
        } else {
            $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
            $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
            $fingerprint = md5($ip . $ua . date('Y-m-d'));
            $visit_id = 'fp_' . $fingerprint;
            
            setcookie($cookie_name, $visit_id, time() + 1800, '/');
            $is_new_visit = true;
        }

        $title = wp_get_document_title();
        if (is_shop()) $title = 'Shop';
        elseif (is_front_page()) $title = 'Home';
        
        $action = [
            'type' => 'page_view',
            'url' => (is_ssl() ? 'https' : 'http') . "://" . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'],
            'title' => $title,
            'time' => time()
        ];

        $this->update_visit_log($visit_id, $action, $is_new_visit);
    }

    private function update_visit_log($visit_id, $new_action, $is_new_visit = false) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'overseek_visits';
        
        $exists = $wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name;
        if (!$exists) $this->install_db_v2();

        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? sanitize_text_field($_SERVER['HTTP_USER_AGENT']) : '';
        $device = ['ua' => $ua, 'is_mobile' => wp_is_mobile()];
        
        $visit_id = sanitize_key($visit_id); 
        $exists_query = $wpdb->prepare("SELECT id, actions FROM $table_name WHERE visit_id = %s", $visit_id);
        $existing_row = $wpdb->get_row($exists_query);

        if (!$existing_row) {
            $wpdb->insert($table_name, [
                'visit_id' => $visit_id,
                'start_time' => current_time('mysql'),
                'last_activity' => current_time('mysql'),
                'ip' => $_SERVER['REMOTE_ADDR'],
                'customer_id' => get_current_user_id(),
                'referrer' => isset($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : '',
                'device_info' => json_encode($device),
                'actions' => json_encode([$new_action])
            ]); 
        } else {
            $actions = json_decode($existing_row->actions, true);
            if (!is_array($actions)) $actions = [];
            $actions[] = $new_action;
            $wpdb->update($table_name, ['actions' => json_encode($actions), 'last_activity' => current_time('mysql')], ['visit_id' => $visit_id]);
        }
    }

    public function log_cart_action($cart_item_key, $product_id, $quantity) {
        $this->track_visit();
    }

    public function log_order_action($order_id) {
         // Placeholder for future logic
    }

    public function get_system_status($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'overseek_visits';
        $exists = $wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name;
        
        return rest_ensure_response([
            'plugin_name' => 'OverSeek Helper',
            'version' => '2.5',
            'namespace' => 'overseek/v1',
            'db_version' => get_option('overseek_db_version'),
            'table_exists' => $exists,
            'wp_version' => get_bloginfo('version'),
            'wc_version' => class_exists('WooCommerce') ? WC()->version : 'Unknown',
            'php_version' => phpversion(),
            'server' => $_SERVER['SERVER_SOFTWARE']
        ]);
    }

    public function get_visitor_log($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'overseek_visits';
        $visits = $wpdb->get_results("SELECT * FROM $table_name ORDER BY last_activity DESC LIMIT 50");
        return rest_ensure_response($visits);
    }
    
    public function get_visitor_count($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'overseek_visits';
        $count = $wpdb->get_var("SELECT COUNT(*) FROM $table_name WHERE last_activity > DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
        return rest_ensure_response(['count' => $count]);
    }

    public function get_carts($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'woocommerce_sessions';
        $sessions = $wpdb->get_results("SELECT * FROM $table_name ORDER BY session_expiry DESC LIMIT 50");
        
        $carts = [];
        foreach ($sessions as $session) {
            $data = maybe_unserialize($session->session_value);
            if (!isset($data['cart']) || empty($data['cart'])) continue;
            $cart_data = maybe_unserialize($data['cart']);
            
            $items = [];
            $total = 0;
            foreach ($cart_data as $item) {
                $total += $item['line_total'];
                $items[] = ['name' => get_the_title($item['product_id']), 'qty' => $item['quantity']];
            }

            $carts[] = [
                'session_key' => $session->session_key,
                'total' => $total,
                'items' => $items,
                'last_update' => date('Y-m-d H:i:s', $session->session_expiry)
            ];
        }
        return rest_ensure_response($carts);
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

    public function get_smtp_settings($request) {
        return rest_ensure_response(get_option('overseek_smtp_settings', []));
    }

    public function update_smtp_settings($request) {
        update_option('overseek_smtp_settings', $request->get_params());
        return rest_ensure_response(['success' => true]);
    }

    public function send_email($request) {
        $to = sanitize_email($request->get_param('to'));
        $subject = sanitize_text_field($request->get_param('subject'));
        $message = wp_kses_post($request->get_param('message'));
        $sent = wp_mail($to, $subject, $message, ['Content-Type: text/html; charset=UTF-8']);
        return rest_ensure_response(['success' => $sent]);
    }

    private function is_bot() {
        if (!isset($_SERVER['HTTP_USER_AGENT'])) return true;
        $ua = strtolower($_SERVER['HTTP_USER_AGENT']);
        return (strpos($ua, 'bot') !== false || strpos($ua, 'crawl') !== false);
    }
}

new OverSeek_Helper_Latest();
