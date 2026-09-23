<?php
/** Loaded only by the aggregate's native checkout subprocess. @package OverSeek */
declare(strict_types=1);
if (!defined('WP_CLI') || !WP_CLI || getenv('OVERSEEK_RUN_DISPOSABLE_DB_TESTS')!=='1') throw new RuntimeException('Disposable WP-CLI only');
WP_CLI::add_hook('after_wp_load', static function(): void {
 global $wpdb;
 $token=getenv('OVERSEEK_NATIVE_CHILD_TOKEN');$fixture=get_option('overseek_native_suite_'.$token);
 if(DB_NAME!=='wordpress_tests'||$wpdb->get_var('SELECT DATABASE()')!=='wordpress_tests'||!is_array($fixture)||!hash_equals($fixture['token'],$token)||get_option('overseek_account_id')!==$fixture['account']) throw new RuntimeException('Checkout child lacks owned disposable fixture');
 error_reporting(E_ALL & ~E_DEPRECATED);
 require_once __DIR__.'/delivery-native-installed-code.php';
 WP_CLI::log('NATIVE_INSTALLED_CODE '.wp_json_encode(overseek_native_installed_code()));
 register_shutdown_function(static function():void{overseek_native_installed_code();});
 require_once __DIR__.'/delivery-native-child-ownership.php';
 overseek_native_track_child($token);
 add_filter('pre_http_request',static fn()=>new WP_Error('native_no_http','No outgoing HTTP'),PHP_INT_MAX);
 add_filter('pre_wp_mail','__return_true',PHP_INT_MAX);
 if(false===has_action('woocommerce_checkout_order_processed',['OverSeek_Delivery_Checkout_Capture','classic'])||false===has_action('woocommerce_store_api_checkout_order_processed',['OverSeek_Delivery_Checkout_Capture','blocks'])) throw new RuntimeException('Production bootstrap capture registration missing');
 WP_CLI::log('NATIVE_BOOTSTRAP_CAPTURE_OK');
 $destination=getenv('OVERSEEK_NATIVE_SNAPSHOTS');
 if($destination) add_action('woocommerce_before_delete_order',static function($id)use($destination):void{
  $order=wc_get_order($id);if(!$order)return;
  $snapshot=$order->get_meta('_overseek_delivery_estimate_v1',true);
  if($snapshot && false===file_put_contents($destination,wp_json_encode(['orderId'=>$id,'snapshot'=>$snapshot])."\n",FILE_APPEND|LOCK_EX)) throw new RuntimeException('Cannot export native snapshot');
 });
});
