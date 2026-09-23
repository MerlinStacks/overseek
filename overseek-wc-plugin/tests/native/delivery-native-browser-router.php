<?php
/** Local PHP development-server router. Never install this as a public WP endpoint. */
if(PHP_SAPI!=='cli-server'||!in_array($_SERVER['REMOTE_ADDR']??'',['127.0.0.1','::1'],true)||getenv('OVERSEEK_RUN_DISPOSABLE_DB_TESTS')!=='1') {http_response_code(403);exit;}
$root=realpath(getenv('OVERSEEK_NATIVE_BROWSER_WP_ROOT')?:'');
$path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);
if(!$root||!is_file($root.'/wp-load.php')){http_response_code(500);exit;}
if($path==='/__native-session'){
 require $root.'/wp-load.php';
 $token=getenv('OVERSEEK_NATIVE_BROWSER_HTTP');$fixture=get_option('overseek_native_suite_'.$token);
 if(DB_NAME!=='wordpress_tests'||!is_array($fixture)||!hash_equals($token,$_SERVER['HTTP_X_NATIVE_FIXTURE']??'')){http_response_code(403);exit;}
 if(!WC()->session)WC()->initialize_session();if(!WC()->cart)WC()->initialize_cart();
 require_once __DIR__.'/delivery-native-child-ownership.php';overseek_native_track_child($token);
 WC()->customer->set_shipping_country('AU');WC()->customer->set_shipping_state('NSW');WC()->customer->set_shipping_postcode('2000');WC()->customer->set_shipping_city('Private Fixture City');WC()->customer->set_shipping_address_1('12 Native Customer Secret Road');WC()->customer->set_calculated_shipping(true);WC()->customer->save();WC()->session->set_customer_session_cookie(true);WC()->session->save_data();
 header('Cache-Control: private, no-store');http_response_code(204);exit;
}
// Serve only public asset types directly; all dynamic requests enter real WordPress.
if(is_string($path)&&!str_contains($path,'..')&&preg_match('/\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|map)$/i',$path)&&is_file($root.$path))return false;
require $root.'/index.php';
