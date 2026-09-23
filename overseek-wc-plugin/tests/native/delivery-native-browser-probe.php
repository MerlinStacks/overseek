<?php
/** Optional MU probe linked only in the owned disposable browser installation. */
if (!defined('ABSPATH') || !defined('DB_NAME') || DB_NAME!=='wordpress_tests' || !in_array(wp_get_environment_type(),['local','development'],true) || (defined('WP_CLI')&&WP_CLI)) return;
$native_probe=get_option('overseek_native_browser_probe');
if(!is_array($native_probe)||getenv('OVERSEEK_NATIVE_BROWSER_HTTP')!==($native_probe['token']??null))return;
$native_http=0;$native_shipping=0;$native_mail=0;
require_once __DIR__.'/delivery-native-installed-code.php';
$native_provenance=null;
add_action('wp_loaded',static function()use(&$native_provenance){$native_provenance=overseek_native_installed_code();},PHP_INT_MAX);
add_filter('pre_http_request',static function($result)use(&$native_http){++$native_http;return new WP_Error('native_browser_no_http','Disposable browser probe blocks server HTTP.');},PHP_INT_MAX);
add_filter('pre_wp_mail',static function()use(&$native_mail){++$native_mail;return true;},PHP_INT_MAX);
add_action('woocommerce_before_get_rates_for_package',static function()use(&$native_shipping){++$native_shipping;});
add_action('shutdown',static function()use($native_probe,&$native_http,&$native_shipping,&$native_mail,&$native_provenance){
 global $wpdb;
 file_put_contents($native_probe['log'],wp_json_encode(['uri'=>$_SERVER['REQUEST_URI']??'','method'=>$_SERVER['REQUEST_METHOD']??'','queries'=>$wpdb->num_queries,'httpAttempts'=>$native_http,'shippingCalculations'=>$native_shipping,'mailAttempts'=>$native_mail,'provenance'=>$native_provenance])."\n",FILE_APPEND|LOCK_EX);
},PHP_INT_MAX);
