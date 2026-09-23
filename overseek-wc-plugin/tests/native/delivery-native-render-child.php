<?php
/** Private subprocess of the WP-CLI aggregate: real frontend callbacks, never a gate bypass. @package OverSeek */
declare(strict_types=1);

if (PHP_SAPI !== 'cli' || getenv('OVERSEEK_RUN_DISPOSABLE_DB_TESTS') !== '1' || !preg_match('/\A[a-f0-9]{24}\z/', getenv('OVERSEEK_NATIVE_CHILD_TOKEN') ?: '') || count($argv) !== 3) throw new RuntimeException('Invoke through delivery-native-integration.php only.');
$root=realpath($argv[1]);$mode=$argv[2];
if (!$root || !is_file($root.'/wp-load.php') || !in_array($mode,['classic','blocks'],true)) throw new RuntimeException('Invalid private child invocation');
if ($mode==='classic') define('WOOCOMMERCE_CART',true); else define('REST_REQUEST',true);
$_SERVER['HTTP_HOST']='native-suite.invalid';$_SERVER['REQUEST_URI']=$mode==='classic'?'/cart/':'/wp-json/wc/store/v1/cart';$_SERVER['REQUEST_METHOD']='GET';
require $root.'/wp-load.php';
error_reporting(E_ALL & ~E_DEPRECATED);
set_exception_handler(static function(Throwable $error):void{fwrite(STDERR,'NATIVE_RENDER_FAILURE '.$error->getMessage()."\n".$error->getTraceAsString()."\n");exit(1);});
global $wpdb,$wp;
if (DB_NAME!=='wordpress_tests' || $wpdb->get_var('SELECT DATABASE()')!=='wordpress_tests' || !in_array(wp_get_environment_type(),['local','development'],true)) throw new RuntimeException('Private frontend requires disposable wordpress_tests');
$token=getenv('OVERSEEK_NATIVE_CHILD_TOKEN');$d=get_option('overseek_native_suite_'.$token);
if (!is_array($d)||!hash_equals($d['token'],$token)||get_option('overseek_account_id')!==$d['account']) throw new RuntimeException('No matching WP-CLI-owned fixture');
require_once __DIR__.'/delivery-native-child-ownership.php';
overseek_native_track_child($token);
if ($mode==='blocks') $wp->query_vars['rest_route']='/wc/store/v1/cart';
require_once __DIR__.'/delivery-native-installed-code.php';
$installed_code=overseek_native_installed_code();
echo 'NATIVE_INSTALLED_CODE '.wp_json_encode($installed_code)."\n";
require_once OVERSEEK_WC_PLUGIN_DIR.'includes/class-overseek-delivery-storefront-context.php';
$checks=0;$http=0;$calculations=0;$adapter_reads=0;$orders=[];
$check=static function(bool $ok,string $message)use(&$checks){if(!$ok)throw new RuntimeException($message);++$checks;echo 'PASS '.$message."\n";};
$deny=static function()use(&$http){++$http;return new WP_Error('native_no_network','No outgoing HTTP');};
add_filter('pre_http_request',$deny,PHP_INT_MAX);add_filter('pre_wp_mail','__return_true',PHP_INT_MAX);
wp_set_current_user($d['manager']);wc_load_cart();
$send=static function(string $path,array $body,int $status=200)use($d,$check){$r=new WP_REST_Request('POST','/overseek/v1/delivery-estimates/'.$path);$r->set_header('content-type','application/json');$r->set_header('x-overseek-account-id',$d['account']);$r->set_body(wp_json_encode($body));$response=rest_do_request($r);$check($response->get_status()===$status,$path.' expected '.$status.' '.wp_json_encode($response->get_data()));return $response->get_data();};
$control=static function(string $action)use($d,$send){$state=OverSeek_Delivery_Control::state();$settings=(new OverSeek_Delivery_Input_Storage())->read_settings();return $send('control',['schemaVersion'=>1,'revision'=>$state['revision']+1,'epoch'=>$d['epoch'],'action'=>$action,'settingsRevision'=>$settings['revision']]);};
$publish=static function()use($d,$send){$s=new OverSeek_Delivery_Input_Storage();$row=$s->read_inbound($d['simple']);$payload=$row['payload'];$guard=(new OverSeek_Receipt_Storage())->guard($d['account'],$d['simple']);$payload['receiptProof']['owners']=[['stockOwnerWooId'=>$d['simple'],'sequence'=>(int)$guard['sequence'],'operationId'=>$guard['operation_id']]];return $send('inputs',['schemaVersion'=>1,'scope'=>'inbound','entityId'=>$d['simple'],'revision'=>$row['revision']+1,'payload'=>$payload]);};
$prepare_cart=static function()use($d){WC()->cart->empty_cart();WC()->customer->set_shipping_country('AU');WC()->customer->set_shipping_state('NSW');WC()->customer->set_shipping_postcode('2000');WC()->customer->set_calculated_shipping(true);WC()->session->set('store_api_draft_order',0);WC()->session->set('order_awaiting_payment',0);WC()->cart->add_to_cart($d['simple'],2);WC()->cart->calculate_totals();};
$render=static function(WC_Shipping_Rate $rate)use($mode):string{if($mode==='blocks')return $rate->get_delivery_time();ob_start();do_action('woocommerce_after_shipping_rate',$rate,0);return trim((string)ob_get_clean());};
$cache_key=static function():?string{$p=new ReflectionProperty(OverSeek_Delivery_Render_Cache::class,'entry');$entry=$p->getValue();return $entry['key']??null;};
$counter=static function()use(&$calculations){++$calculations;};
$query=static function($sql)use(&$adapter_reads){if(str_contains($sql,'SELECT revision, payload FROM ')&&str_contains($sql,"scope = 'product'"))++$adapter_reads;return $sql;};
try {
 if(!OverSeek_Delivery_Storefront_Gate::is_active())echo 'GATE_DIAGNOSTIC '.wp_json_encode(['state'=>OverSeek_Delivery_Control::state(),'fingerprint'=>OverSeek_Delivery_Control::fingerprint(),'settings'=>(new OverSeek_Delivery_Input_Storage())->read_settings()])."\n";
 $check(OverSeek_Delivery_Storefront_Gate::is_active(),'Unmodified real gate active in '.$mode.' native context');
 $prepare_cart();$package=OverSeek_Delivery_Storefront_Context::current_package();$rates=$package['rates']??[];
 $check(count($rates)===20,'Exactly twenty actual native offered options');
 $first=$rates[$d['capture_rates'][0]];$unmapped=$rates['flat_rate:'.$d['core'][11]['instance']];
 add_action('woocommerce_before_get_rates_for_package',$counter);add_filter('query',$query);
 $before=serialize($rates);
 // Five cold application-cache batches after native Woo fixture setup; SQL counts exclude setup.
 foreach([1,20] as $size){$samples=[];for($i=0;$i<5;++$i){OverSeek_Delivery_Render_Cache::clear();$q=$wpdb->num_queries;$reads=$adapter_reads;$start=hrtime(true);$output=[];foreach(array_slice(array_values($rates),0,$size) as $rate)$output[]=$render($rate);$samples[]=['queries'=>$wpdb->num_queries-$q,'milliseconds'=>(hrtime(true)-$start)/1e6,'adapter_product_reads'=>$adapter_reads-$reads];$check($output[0]!=='',"$mode $size-rate cold batch outputs mapped dates");$check($adapter_reads-$reads===1,'One adapter product-input read per cold batch, independent of callback count');}echo 'METRIC '.wp_json_encode(['mode'=>$mode,'callbacks'=>$size,'samples'=>$samples])."\n";}
 $q=$wpdb->num_queries;$reads=$adapter_reads;$start=hrtime(true);$output=[];for($i=0;$i<20;++$i)$output[]=$render($unmapped);
 echo 'METRIC '.wp_json_encode(['mode'=>$mode,'warm_unmapped_callbacks'=>20,'queries'=>$wpdb->num_queries-$q,'milliseconds'=>(hrtime(true)-$start)/1e6,'adapter_product_reads'=>$adapter_reads-$reads])."\n";
 foreach($output as $text)$check($text==='','Unmapped actual rate remains blank');
 $check($adapter_reads===$reads,'Repeated unmapped callbacks reuse complete cached calculation');
 foreach(array_chunk(array_slice($d['capture_rates'],0,8),2) as [$standard,$express])$check($render($rates[$standard])!==$render($rates[$express])&&$render($rates[$express])!=='','Native Standard/Express global/zoned outputs preserve independent transit ranges');
 $check(serialize($rates)===$before,'Actual callbacks preserve all native provider rate data');
 $check($http===0&&$calculations===0,'Measured callbacks initiate zero HTTP/rate calculations');

 // Warm result -> real control/stock/input changes -> next callback, without cache resets.
 $check($render($first)!=='','Warm result before explicit disable');$control('disable');
 $check((new OverSeek_Delivery_Input_Storage())->read_settings()['payload']['enabled']===true,'Settings remain enabled during explicit disable test');
 $check($render($first)==='','Warm callback blanks immediately on explicit disable');$control('activate');$check($render($first)!=='','Reactivation restores callback');
 $s=new OverSeek_Delivery_Input_Storage();$row=$s->read_settings();$send('inputs',['schemaVersion'=>1,'scope'=>'settings','entityId'=>0,'revision'=>$row['revision']+1,'payload'=>$row['payload']]);
 $check($render($first)==='','New settings revision invalidates warmed admission');$control('activate');$check($render($first)!=='','New settings activation restores admission');
 $key=$cache_key();$row=$s->read_product($d['simple']);$payload=$row['payload'];$payload['productionMinDays']++;$payload['productionMaxDays']++;
 $old_text=$render($first);$send('inputs',['schemaVersion'=>1,'scope'=>'product','entityId'=>$d['simple'],'revision'=>$row['revision']+1,'payload'=>$payload]);
 $check($render($first)!==$old_text&&$cache_key()!==$key,'Production input revision recomputes dates');
 $guard=(new OverSeek_Receipt_Storage())->guard($d['account'],$d['simple']);$op=['operationId'=>'render_'.bin2hex(random_bytes(8)),'sequence'=>(int)$guard['sequence']+1,'productWooId'=>$d['simple'],'variationWooId'=>null,'stockOwnerWooId'=>$d['simple'],'delta'=>1];
 $send('receipts/prepare',['schemaVersion'=>1,'operation'=>$op]);$check($render($first)==='','Pending receipt invalidates warm dates immediately');
 $send('receipts/apply',['schemaVersion'=>1,'operation'=>$op]);$check($render($first)==='','Applied receipt stays blank until matching proof publication');$publish();$check($render($first)!=='','New proof releases warm receipt guard');
 $stock=(int)wc_get_product($d['simple'])->get_stock_quantity();wc_update_product_stock($d['simple'],0,'set');$check($render($first)==='','Direct native stock change invalidates warm dates');wc_update_product_stock($d['simple'],$stock,'set');$check($render($first)!=='','Restored stock recomputes availability');
 $p=wc_get_product($d['simple']);$order=wc_create_order(['status'=>'pending']);$orders[]=$order->get_id();$order->add_product($p,$stock);$order->save();wc_reserve_stock_for_order($order);
 $check($render($first)==='','New native other-order held reservation invalidates warm result');wc_release_stock_for_order($order);$check($render($first)!=='','Released held demand restores dates');
 $cart_key=array_key_first(WC()->cart->get_cart());WC()->cart->set_quantity($cart_key,3,false);
 $check($render($first)==='','Quantity change rejects stale loaded package');
 remove_action('woocommerce_before_get_rates_for_package',$counter);WC()->cart->calculate_totals();add_action('woocommerce_before_get_rates_for_package',$counter);
 $rates=OverSeek_Delivery_Storefront_Context::current_package()['rates'];$first=$rates[$d['capture_rates'][0]];$check($render($first)!=='','Normal native recalculation certifies new quantity');
 WC()->customer->set_shipping_postcode('3000');$check($render($first)==='','Address change rejects old loaded package');WC()->customer->set_shipping_postcode('2000');$check($render($first)!=='','Restored native destination valid again');
 $key=$cache_key();$reads=$adapter_reads;$first->set_cost((float)$first->get_cost()+1);$check($render($first)!==''&&$cache_key()!==$key&&$adapter_reads>$reads,'Actual rate cost change invalidates cached key');
 $key=$cache_key();$first->add_meta_data('native_test_token','changed');$check($render($first)!==''&&$cache_key()!==$key,'Actual rate metadata change invalidates cached key');
 require_once ABSPATH.'wp-admin/includes/plugin.php';activate_plugin($d['old_plugin']);$check($render($first)==='','Old-plugin fingerprint invalidates warm dates');deactivate_plugins($d['old_plugin']);$control('activate');$check($render($first)!=='','Explicit recovery from environment change restores dates');
 $check($http===0&&$calculations===0,'Mutation callbacks add no HTTP/provider calculations');
 overseek_native_installed_code();
 echo "NATIVE_RENDER_SUCCESS $mode checks=$checks\n";
} finally {
 foreach($orders as $id){$order=wc_get_order($id);if($order){wc_release_stock_for_order($order);$order->delete(true);}}
 WC()->cart->empty_cart();remove_action('woocommerce_before_get_rates_for_package',$counter);remove_filter('query',$query);
}
