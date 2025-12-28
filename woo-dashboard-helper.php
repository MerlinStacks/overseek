<?php
/**
 * Plugin Name: Woo Dashboard Helper
 * Description: Exposes Cart Abandonment data, Visitor Logs, and SMTP Settings to the React Dashboard.
 * Version: 2.1
 * Author: Dashboard
 */

if (!defined('ABSPATH')) exit;

class WooDashHelper {
    public function __construct() {
        // 1. Critical: Handle CORS and Auth immediately
        add_action('init', [$this, 'handle_cors'], 0); // Priority 0 to run before others
        
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action('phpmailer_init', [$this, 'configure_smtp']);
        
        // Visitor Tracking
        add_action('template_redirect', [$this, 'track_visit']);
        
        // Log Events
        add_action('admin_init', [$this, 'install_db_v2']);
        add_action('woocommerce_add_to_cart', [$this, 'log_cart_action'], 10, 6);
        add_action('woocommerce_thankyou', [$this, 'log_order_action'], 10, 1);
    }

    public function handle_cors() {
        // Only run for REST API requests to ensure we don't open up the whole site
        if (strpos($_SERVER['REQUEST_URI'], '/wp-json/') === false) return;

        // 1. Restore Authorization Header
        if (!isset($_SERVER['HTTP_AUTHORIZATION'])) {
            if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
                $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
            } elseif (isset($_SERVER['PHP_AUTH_USER'])) {
                // Keep existing basic auth
            }
        }

        // 2. Clear existing headers to prevent duplicates
        header_remove('Access-Control-Allow-Origin');
        header_remove('Access-Control-Allow-Methods');
        header_remove('Access-Control-Allow-Headers');
        header_remove('Access-Control-Allow-Credentials');

        // 3. Send Correct CORS Headers with Security Check
        $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
        
        // Allowed origins filter
        $allowed_origins = apply_filters('wc_dash_allowed_origins', [
            'http://localhost:5173',
            'http://localhost:3000',
            'http://127.0.0.1:5173',
            'app://.' 
        ]);

        // Smart Origin handling:
        // If the origin is in our whitelist OR looks like a local dev environment, echo it back.
        // Otherwise, do not send the header (effectively blocking CORS for browsers).
        $allow_origin = null;
        
        $is_local = strpos($origin, 'localhost') !== false || strpos($origin, '127.0.0.1') !== false;
        
        if (in_array($origin, $allowed_origins) || $is_local) {
            $allow_origin = $origin;
        }

        if ($allow_origin) {
            header("Access-Control-Allow-Origin: $allow_origin");
            header("Access-Control-Allow-Methods: POST, GET, OPTIONS, PUT, DELETE");
            header("Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With, X-WP-Nonce");
            header("Access-Control-Allow-Credentials: true");
        }

        // 4. Handle Preflight immediately
        if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
            status_header(200);
            exit();
        }
    }

    public function install_db_v2() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'wc_dash_visits';
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

        $wpdb->query($sql);

        update_option('wc_dash_db_version', '2.5');
        return true;
    }

    public function register_routes() {
        // Force Install/Repair DB
        register_rest_route('wc-dash/v1', '/install-db', [
            'methods' => 'POST',
            'callback' => function() {
                $this->install_db_v2();
                return rest_ensure_response(['success' => true, 'message' => 'Database repair attempted']);
            },
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);
        
        // Manual Test Visit
        register_rest_route('wc-dash/v1', '/test-visit', [
            'methods' => 'POST',
            'callback' => [$this, 'create_test_visit'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);

        // Status Debug
        register_rest_route('wc-dash/v1', '/status', [
            'methods' => 'GET',
            'callback' => [$this, 'get_system_status'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);

        // Carts
        register_rest_route('wc-dash/v1', '/carts', [
            'methods' => 'GET',
            'callback' => [$this, 'get_carts'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);

        // Email
        register_rest_route('wc-dash/v1', '/email/send', [
            'methods' => 'POST',
            'callback' => [$this, 'send_email'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);

        // SMTP
        register_rest_route('wc-dash/v1', '/settings/smtp', [
            'methods' => 'GET',
            'callback' => [$this, 'get_smtp_settings'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);
        register_rest_route('wc-dash/v1', '/settings/smtp', [
            'methods' => 'POST',
            'callback' => [$this, 'update_smtp_settings'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);

        // Visitor Log
        register_rest_route('wc-dash/v1', '/visitor-log', [
            'methods' => 'GET',
            'callback' => [$this, 'get_visitor_log'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);
        
        // Count for legacy/simple view
        register_rest_route('wc-dash/v1', '/visitors', [
            'methods' => 'GET',
            'callback' => [$this, 'get_visitor_count'],
            'permission_callback' => function() { return current_user_can('manage_woocommerce'); }
        ]);
    }

    // --- Tracking Logic ---

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
        
        // Exclude admin pages AND admin users/shop managers from tracking
        if (is_admin() || current_user_can('manage_options') || current_user_can('manage_woocommerce')) return; 
        
        // Track everything on frontend except robots
        if (is_robots() || is_feed() || is_trackback() || $this->is_bot()) return;

        // Hybrid Tracking: Cookie > Fingerprint
        $cookie_name = 'wc_dash_vid';
        $visit_id = '';
        $is_new_visit = false;

        if (isset($_COOKIE[$cookie_name])) {
            $visit_id = sanitize_key($_COOKIE[$cookie_name]);
            // Extend cookie
            setcookie($cookie_name, $visit_id, time() + 1800, '/');
        } else {
            // Generate Fingerprint ID (IP + User Agent + Date)
            $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0.0.0.0';
            $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
            $fingerprint = md5($ip . $ua . date('Y-m-d'));
            $visit_id = 'fp_' . $fingerprint;
            
            setcookie($cookie_name, $visit_id, time() + 1800, '/');
            $is_new_visit = true;
        }

        // 2. Prepare Action Data
        $title = '';
        if (is_shop()) {
            $title = 'Shop';
        } elseif (is_front_page() || is_home()) {
            $title = 'Home';
        } elseif (is_singular()) {
            $title = get_the_title(get_queried_object_id());
        } elseif (is_search()) {
            $title = 'Search: ' . get_search_query();
        } elseif (is_category() || is_tag() || is_tax()) {
            $title = single_term_title('', false);
        } else {
            $title = wp_get_document_title();
        }
        
        if (empty($title)) $title = 'Unknown Page';

        // Sanitize Server Vars
        $host = isset($_SERVER['HTTP_HOST']) ? sanitize_text_field($_SERVER['HTTP_HOST']) : '';
        // Use esc_url_raw to preserve query strings (UTM/MTM) while making it safe
        $uri = isset($_SERVER['REQUEST_URI']) ? esc_url_raw($_SERVER['REQUEST_URI']) : '';

        $action = [
            'type' => 'page_view',
            'url' => (is_ssl() ? 'https' : 'http') . "://$host$uri",
            'title' => $title,
            'time' => time()
        ];

        // 3. Log to DB
        $this->update_visit_log($visit_id, $action, $is_new_visit);
    }

    private function update_visit_log($visit_id, $new_action, $is_new_visit = false) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'wc_dash_visits';
        
        // Ensure table matches correct version
        if (get_option('wc_dash_db_version') !== '2.5') {
           $this->install_db_v2(); 
        }

        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? sanitize_text_field($_SERVER['HTTP_USER_AGENT']) : '';
        $browser = 'Unknown';
        if (strpos($ua, 'Chrome') !== false) $browser = 'Chrome';
        elseif (strpos($ua, 'Firefox') !== false) $browser = 'Firefox';
        elseif (strpos($ua, 'Safari') !== false) $browser = 'Safari';
        elseif (strpos($ua, 'Edge') !== false) $browser = 'Edge';

        $os = 'Unknown';
        if (strpos($ua, 'Windows') !== false) $os = 'Windows';
        elseif (strpos($ua, 'Mac') !== false) $os = 'MacOS';
        elseif (strpos($ua, 'Linux') !== false) $os = 'Linux';
        elseif (strpos($ua, 'Android') !== false) $os = 'Android';
        elseif (strpos($ua, 'iPhone') !== false) $os = 'iOS';

        $device = [
            'browser' => $browser,
            'os' => $os,
            'is_mobile' => wp_is_mobile(),
            'ua' => $ua
        ];
        
        $visit_id = sanitize_key($visit_id); 
        // Use prepared statement to avoid SQL injection
        $exists_query = $wpdb->prepare("SELECT id, actions FROM $table_name WHERE visit_id = %s", $visit_id);
        $existing_row = $wpdb->get_row($exists_query);

        if (!$existing_row) {
            $wpdb->insert($table_name, [
                'visit_id' => $visit_id,
                'start_time' => current_time('mysql'),
                'last_activity' => current_time('mysql'),
                'ip' => isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field($_SERVER['REMOTE_ADDR']) : '0.0.0.0',
                'customer_id' => get_current_user_id(),
                'referrer' => isset($_SERVER['HTTP_REFERER']) ? sanitize_text_field($_SERVER['HTTP_REFERER']) : '',
                'device_info' => json_encode($device),
                'actions' => json_encode([$new_action])
            ], ['%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s']); 
        } else {
            $actions = json_decode($existing_row->actions, true);
            if (!is_array($actions)) $actions = [];
            $actions[] = $new_action;
            
            $wpdb->update(
                $table_name, 
                ['actions' => json_encode($actions), 'last_activity' => current_time('mysql')], 
                ['visit_id' => $visit_id],
                ['%s', '%s'],
                ['%s']
            );
        }
    }

    public function log_cart_action($cart_item_key, $product_id, $quantity) {
        $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
        $fallback_id = 'fp_' . md5($ip . $ua . date('Y-m-d'));
        
        $visit_id = isset($_COOKIE['wc_dash_vid']) ? sanitize_key($_COOKIE['wc_dash_vid']) : $fallback_id;
        
        $product = wc_get_product($product_id);
        $action = [
            'type' => 'add_to_cart',
            'name' => $product ? $product->get_name() : 'Unknown Product',
            'qty' => $quantity,
            'time' => time()
        ];
        $this->update_visit_log($visit_id, $action);
    }

    public function log_order_action($order_id) {
        $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
        $fallback_id = 'fp_' . md5($ip . $ua . date('Y-m-d'));

        $visit_id = isset($_COOKIE['wc_dash_vid']) ? sanitize_key($_COOKIE['wc_dash_vid']) : $fallback_id;
        
        $order = wc_get_order($order_id);
        $action = [
            'type' => 'order',
            'order_id' => $order_id,
            'total' => $order ? $order->get_total() : 0,
            'time' => time()
        ];
        $this->update_visit_log($visit_id, $action);
    }

    // --- API Handlers ---
    
    public function get_system_status($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'wc_dash_visits';
        $exists = $wpdb->get_var("SHOW TABLES LIKE '$table_name'") == $table_name;
        $row_count = $exists ? $wpdb->get_var("SELECT COUNT(*) FROM $table_name") : 0;
        
        return rest_ensure_response([
            'db_version' => get_option('wc_dash_db_version'),
            'table_exists' => $exists,
            'table_name' => $table_name,
            'row_count' => $row_count,
            'mysql_version' => $wpdb->db_version(),
            'server_time' => current_time('mysql'),
            'active_plugins' => get_option('active_plugins')
        ]);
    }

    public function get_visitor_log($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'wc_dash_visits';

        if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") != $table_name) {
            return rest_ensure_response([]);
        }

        $visits = $wpdb->get_results("SELECT * FROM $table_name ORDER BY last_activity DESC LIMIT 100");
        
        // --- PERFORMANCE OPTIMIZATION: BATCH FETCHING ---
        // 1. Collect IDs
        $customer_ids = [];
        $order_ids = [];
        
        foreach ($visits as $visit) {
            $visit->device_info = json_decode($visit->device_info);
            $visit->actions = json_decode($visit->actions);
            
            if ($visit->customer_id > 0) {
                $customer_ids[] = $visit->customer_id;
            }
            
            if (!empty($visit->actions)) {
                foreach ($visit->actions as $action) {
                    if (isset($action->type) && $action->type === 'order' && isset($action->order_id)) {
                        $order_ids[] = $action->order_id;
                    }
                }
            }
        }
        
        // 2. Batch Fetch Data
        $users_map = [];
        if (!empty($customer_ids)) {
            $customer_ids = array_unique($customer_ids);
            // In WP, get_users can be heavy, but get_userdata is cached. 
            // Better to just loop get_userdata if IDs are few, or query DB if many.
            // With limit 100, looping get_userdata is actually often fine due to WP object cache.
            // But let's pre-query to be safe if no cache.
            $users = get_users(['include' => $customer_ids, 'fields' => ['ID', 'display_name', 'user_email']]);
            foreach ($users as $u) {
                $users_map[$u->ID] = $u->display_name;
            }
        }
        
        // 3. Map Data
        foreach ($visits as &$visit) {
            $visit->customer_name = '';
            
            // Logged in user
            if ($visit->customer_id > 0 && isset($users_map[$visit->customer_id])) {
                $visit->customer_name = $users_map[$visit->customer_id];
            }
            
            // Guest order resolution
            if (empty($visit->customer_name) && !empty($visit->actions)) {
                foreach ($visit->actions as $action) {
                    if (isset($action->type) && $action->type === 'order' && isset($action->order_id)) {
                        // wc_get_order is cached by WC, so repeated calls for same order are cheap. 
                        // If 100 unique orders, it might be 100 DB queries if not warm. 
                        // Acceptable for this dashboard scale.
                        $order = wc_get_order($action->order_id);
                        if ($order) {
                            $visit->customer_name = $order->get_billing_first_name() . ' ' . $order->get_billing_last_name();
                        }
                    }
                }
            }
        }

        return rest_ensure_response($visits);
    }
    
    public function get_visitor_count($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'wc_dash_visits';
        // Count visits active in last 10 mins
        $count = $wpdb->get_var("SELECT COUNT(*) FROM $table_name WHERE last_activity > DATE_SUB(NOW(), INTERVAL 3 MINUTE)");
        return rest_ensure_response(['count' => $count, 'timestamp' => time()]);
    }

    public function get_carts($request) {
        global $wpdb;
        $table_name = $wpdb->prefix . 'woocommerce_sessions';
        if ($wpdb->get_var("SHOW TABLES LIKE '$table_name'") != $table_name) {
            return new WP_Error('no_table', 'Sessions table not found', ['status' => 404]);
        }
        $sessions = $wpdb->get_results("SELECT * FROM $table_name ORDER BY session_expiry DESC LIMIT 100");
        $carts = [];
        foreach ($sessions as $session) {
            $data = maybe_unserialize($session->session_value);
            if (!isset($data['cart']) || empty($data['cart'])) continue;
            $cart_data = maybe_unserialize($data['cart']);
            if (empty($cart_data)) continue;
            $customer_id = $session->session_key;
            $user_email = ''; $first_name = 'Guest'; $last_name = '';
            if (is_numeric($customer_id)) {
                $user = get_userdata($customer_id);
                if ($user) { $user_email = $user->user_email; $first_name = $user->first_name; $last_name = $user->last_name; }
            } 
            if (isset($data['customer'])) {
                $cust = maybe_unserialize($data['customer']);
                if (!empty($cust['email'])) $user_email = $cust['email'];
                if (!empty($cust['first_name'])) $first_name = $cust['first_name'];
                if (!empty($cust['last_name'])) $last_name = $cust['last_name'];
            }
            $total = 0; $items = [];
            foreach ($cart_data as $key => $item) {
                $line_total = isset($item['line_total']) ? $item['line_total'] : 0;
                $total += $line_total;
                $items[] = ['product_id' => $item['product_id'], 'name' => get_the_title($item['product_id']), 'qty' => $item['quantity'], 'total' => $line_total];
            }
            $carts[] = [
                'session_key' => $session->session_key,
                'last_update' => date('Y-m-d H:i:s', $session->session_expiry - (2 * 24 * 60 * 60)),
                'customer' => ['id' => is_numeric($customer_id) ? $customer_id : 0, 'email' => $user_email, 'first_name' => $first_name, 'last_name' => $last_name],
                'items' => $items, 'total' => $total, 'currency' => get_woocommerce_currency()
            ];
        }
        return rest_ensure_response($carts);
    }

    public function configure_smtp($phpmailer) {
        $smtp = get_option('wc_dash_smtp_settings', []);
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
        $settings = get_option('wc_dash_smtp_settings', ['enabled' => 'no', 'host' => '', 'port' => '587', 'username' => '', 'password' => '', 'encryption' => 'tls', 'from_email' => get_option('admin_email'), 'from_name' => get_option('blogname')]);
        return rest_ensure_response($settings);
    }

    public function update_smtp_settings($request) {
        $settings = [
            'enabled' => sanitize_text_field($request->get_param('enabled')),
            'host' => sanitize_text_field($request->get_param('host')),
            'port' => sanitize_text_field($request->get_param('port')),
            'username' => sanitize_text_field($request->get_param('username')),
            'password' => sanitize_text_field($request->get_param('password')),
            'encryption' => sanitize_text_field($request->get_param('encryption')),
            'from_email' => sanitize_email($request->get_param('from_email')),
            'from_name' => sanitize_text_field($request->get_param('from_name')),
        ];
        update_option('wc_dash_smtp_settings', $settings);
        return rest_ensure_response(['success' => true, 'message' => 'SMTP settings saved']);
    }

    public function send_email($request) {
        $to = sanitize_email($request->get_param('to'));
        $subject = sanitize_text_field($request->get_param('subject'));
        $message = wp_kses_post($request->get_param('message'));
        if (empty($to)) return new WP_Error('missing_email', 'No recipient provided', ['status' => 400]);
        $headers = ['Content-Type: text/html; charset=UTF-8'];
        $sent = wp_mail($to, $subject, $message, $headers);
        if ($sent) return rest_ensure_response(['success' => true, 'message' => 'Email sent successfully']);
        else return new WP_Error('send_failed', 'Email failed to send via wp_mail', ['status' => 500]);
    }

    /**
     * Check if the current visitor is a bot/crawler
     */
    private function is_bot() {
        if (!isset($_SERVER['HTTP_USER_AGENT'])) {
            return true; // No UA usually means a script
        }
        
        $ua = strtolower($_SERVER['HTTP_USER_AGENT']);
        
        // Common bots, crawlers, and link preview services
        $bot_signatures = [
            'bot', 'crawl', 'slurp', 'spider', 'mediapartners',
            'facebookexternalhit', 'whatsapp', 'telegram', 'twitterbot', 'linkedinbot', 'slackbot', 'discordbot',
            'pinterest', 'google-inspectiontool', 'lighthouse',
            'curl', 'wget', 'python', 'php', 'java', 'httpclient', 'axios', 'postman'
        ];

        foreach ($bot_signatures as $sign) {
            if (strpos($ua, $sign) !== false) {
                return true;
            }
        }

        return false;
    }
}
new WooDashHelper();
