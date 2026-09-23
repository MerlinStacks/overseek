<?php
/** Disposable native fixture ownership, real REST transport and teardown. @package OverSeek */
declare(strict_types=1);

final class OverSeek_Native_Fixture {
 public array $data = [];
 public int $checks = 0;
 private array $options = [];
 private array $products = [];
 private array $pages = [];
 private array $zones = [];
 private array $zone_orders = [];
 private array $users = [];
 private array $triggers = [];
 private int $original_user;
 private string $old_plugin = '';
 private $deny_http;
 private $deny_mail;

 public static function guard(): void {
  global $wpdb;
  if (!defined('WP_CLI') || WP_CLI !== true || PHP_SAPI !== 'cli' || getenv('OVERSEEK_RUN_DISPOSABLE_DB_TESTS') !== '1' || !defined('DB_NAME') || DB_NAME !== 'wordpress_tests' || $wpdb->get_var('SELECT DATABASE()') !== 'wordpress_tests' || !in_array(wp_get_environment_type(), ['local','development'], true)) {
   throw new RuntimeException('Requires WP-CLI, explicit disposable consent, local/development environment and actual wordpress_tests database.');
  }
  if (!class_exists('WooCommerce') || !class_exists('Wbs\\ShippingMethod') || !class_exists('Aikinomi\\Wbsng\\ShippingMethod') || (string) Wbs\Plugin::instance()->meta->version !== '6.18.0') throw new RuntimeException('Activate Woo, OverSeek and public WBS 6.18.0 first.');
 }

 public function __construct() {
  self::guard();
  $this->original_user = get_current_user_id();
  $this->data = ['token'=>bin2hex(random_bytes(12)), 'account'=>'native_'.bin2hex(random_bytes(8)), 'epoch'=>'epoch_'.bin2hex(random_bytes(8))];
  $this->deny_http = static fn() => new WP_Error('native_no_http','Native integration denies outgoing HTTP.');
  $this->deny_mail = static fn() => true;
  add_filter('pre_http_request', $this->deny_http, PHP_INT_MAX);
  add_filter('pre_wp_mail', $this->deny_mail, PHP_INT_MAX);
 }

 public function check(bool $ok, string $message): void {
  if (!$ok) throw new RuntimeException($message);
  ++$this->checks;
  WP_CLI::log('PASS '.$message);
 }

 public function option(string $name, $value): void {
  $this->remember($name);
  update_option($name, $value);
 }

 private function remember(string $name): void {
  if (!array_key_exists($name, $this->options)) {
   $missing = new stdClass(); $value = get_option($name, $missing);
   $this->options[$name] = ['exists'=>$value !== $missing,'value'=>$value];
  }
 }

 public function request(string $path, array $body = [], int $status = 200, string $method = 'POST', ?string $account = null): array {
  $r = new WP_REST_Request($method, '/overseek/v1/delivery-estimates/'.$path);
  $r->set_header('x-overseek-account-id', $account ?? $this->data['account']);
  $r->set_header('content-type','application/json');
  if ($method === 'POST') $r->set_body(wp_json_encode($body));
  $response = rest_do_request($r);
  $this->check($response->get_status() === $status, "$path HTTP $status; received ".wp_json_encode($response->get_data()));
  return $response->get_data();
 }

 public function input(string $scope, int $id, array $payload, int $status = 200): array {
  $storage = new OverSeek_Delivery_Input_Storage();
  $row = $scope === 'settings' ? $storage->read_settings() : ($scope === 'product' ? $storage->read_product($id) : $storage->read_inbound($id));
  return $this->request('inputs', ['schemaVersion'=>1,'scope'=>$scope,'entityId'=>$id,'revision'=>($row['revision'] ?? 0)+1,'payload'=>$payload], $status);
 }

 public function control(string $action, array $extra = [], int $status = 200): array {
  return $this->request('control', array_merge(['schemaVersion'=>1,'revision'=>OverSeek_Delivery_Control::state()['revision']+1,'action'=>$action,'epoch'=>$this->data['epoch']], $extra), $status);
 }

 public function activate(): void {
  $this->control('activate', ['settingsRevision'=>(new OverSeek_Delivery_Input_Storage())->read_settings()['revision']]);
  $this->check(OverSeek_Delivery_Storefront_Gate::is_active(), 'Real account-bound activation gate active');
 }

 public function inbound(int $id, array $targets, int $owner, ?array $proof = null): array {
  $payload = ['wooId'=>$id,'generatedAt'=>gmdate('Y-m-d\TH:i:s\Z'),'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z', time()+86400),'receiptSafety'=>$proof ? 'verified' : 'unverified','targets'=>array_map(static fn($target)=>['wooId'=>$target,'stockOwnerWooId'=>$owner,'state'=>'pending','supplierLead'=>['min'=>5,'max'=>5],'batches'=>[]],$targets)];
  if ($proof) $payload['receiptProof'] = ['version'=>1,'epoch'=>$this->data['epoch'],'owners'=>$proof];
  return $payload;
 }

 public function publish(int $id, array $targets, int $owner): void {
  $guard = (new OverSeek_Receipt_Storage())->guard($this->data['account'],$owner);
  $this->input('inbound', $id, $this->inbound($id,$targets,$owner,[['stockOwnerWooId'=>$owner,'sequence'=>(int)$guard['sequence'],'operationId'=>$guard['operation_id']]]));
 }

 public function operation(int $product, int $delta, ?int $variation = null, ?int $owner = null): array {
  $owner ??= $product;
  $guard = (new OverSeek_Receipt_Storage())->guard($this->data['account'],$owner);
  return ['operationId'=>'op_'.bin2hex(random_bytes(8)),'sequence'=>(int)($guard['sequence'] ?? 0)+1,'productWooId'=>$product,'variationWooId'=>$variation,'stockOwnerWooId'=>$owner,'delta'=>$delta];
 }

 public function receipt(string $action, array $op, string $expected): array {
  $ack = $this->request('receipts/'.$action,['schemaVersion'=>1,'operation'=>$op]);
  $this->check($ack['state'] === $expected,"Native receipt $action -> $expected");
  return $ack;
 }

 public function setup(): void {
  require_once __DIR__.'/delivery-native-installed-code.php';
  overseek_native_installed_code();
  require_once OVERSEEK_WC_PLUGIN_DIR.'includes/class-overseek-delivery-storefront-context.php';
  require_once ABSPATH.'wp-admin/includes/plugin.php';
  $this->remember('active_plugins');
  $this->remember('overseek_delivery_environment_generation');
  foreach (['shipping-transient-version','wc_shipping_method_count','wc_shipping_method_count_legacy','wc_shipping_method_count_admin'] as $key) {
   $this->remember('_transient_'.$key); $this->remember('_transient_timeout_'.$key);
  }
  $this->option('overseek_account_id',$this->data['account']);
  foreach (['woocommerce_manage_stock'=>'yes','woocommerce_hold_stock_minutes'=>'60','woocommerce_enable_guest_checkout'=>'yes','woocommerce_shipping_debug_mode'=>'no','woocommerce_shipping_hide_rates_when_free'=>'no','woocommerce_calc_taxes'=>'no','woocommerce_custom_orders_table_data_sync_enabled'=>'no','woocommerce_pickup_location_settings'=>['enabled'=>false]] as $key=>$value) $this->option($key,$value);
  $this->remember('woocommerce_custom_orders_table_enabled');
  $user = wp_insert_user(['user_login'=>$this->data['account'],'user_pass'=>wp_generate_password(32),'role'=>'shop_manager']);
  if (is_wp_error($user)) throw new RuntimeException($user->get_error_message());
  $this->users[] = $user; $this->data['manager'] = $user; wp_set_current_user($user);
  foreach (['cart','checkout'] as $kind) {
   $id = wp_insert_post(['post_type'=>'page','post_status'=>'publish','post_title'=>'Native '.$kind.' '.$this->data['token'],'post_content'=>'[woocommerce_'.$kind.']']);
   // Match the scalar type returned on the next real admin/frontend request.
   $this->pages[] = $id; $this->option('woocommerce_'.$kind.'_page_id',(string)$id);
  }
  foreach (WC_Shipping_Zones::get_zones() as $row) {
   $zone = new WC_Shipping_Zone($row['zone_id']); $this->zone_orders[$zone->get_id()] = $zone->get_zone_order(); $zone->set_zone_order($zone->get_zone_order()+100); $zone->save();
  }
  $zone = new WC_Shipping_Zone(); $zone->set_zone_name('Native '.$this->data['token']); $zone->set_zone_order(0); $zone->add_location('AU','country'); $zone->save();
  $this->zones[] = $zone->get_id(); $this->data['zone'] = $zone->get_id();
  $this->option('wbs_global_methods','both');
  $legacy=['enabled'=>true,'rules'=>[]]; $ng=['settings'=>['disableSplitShipping'=>true],'methods'=>[]];
  foreach (['Standard','Express'] as $title) {
   // Zero native charges allow real Store API place-order without a payment gateway.
   $legacy['rules'][]=['meta'=>['enabled'=>true,'title'=>$title,'taxable'=>true],'conditions'=>['destination'=>['mode'=>'all']],'charges'=>['base'=>0,'weight'=>['cost'=>0,'step'=>1,'skip'=>0]]];
   $ng['methods'][]=['name'=>$title,'settings'=>null,'rules'=>[['name'=>'','locations'=>null,'shclasses'=>null,'weight'=>null,'price'=>null,'action'=>null,'charge'=>['base'=>'0','rate'=>'0','step'=>'1','skip'=>'0']]]];
  }
  foreach (['wbs','wbsng'] as $provider) {
   $instance = $zone->add_shipping_method($provider); $this->data['instances'][$provider] = $instance;
   foreach ([0,$instance] as $id) {
    $this->remember($provider.($id ? '_'.$id : '').'_config');
    if ($provider === 'wbs') (new Wbs\ShippingMethod($id))->config($legacy);
    else (new Aikinomi\Wbsng\ShippingMethod($id))->updateConfigData($ng);
   }
  }
  $this->data['core'] = [];
  for ($i=0;$i<12;++$i) {
   $method = $i===1 ? 'local_pickup' : 'flat_rate'; $instance = $zone->add_shipping_method($method);
   $this->option('woocommerce_'.$method.'_'.$instance.'_settings',['title'=>'Native option '.$i,'tax_status'=>'taxable','cost'=>'0']);
   $this->data['core'][] = ['method'=>$method,'instance'=>$instance,'mapped'=>$i<6];
  }
  foreach (['simple'=>true,'unmanaged'=>false] as $key=>$managed) {
   $p=new WC_Product_Simple(); $p->set_name('Native '.$key.' '.$this->data['token']); $p->set_status('publish'); $p->set_regular_price('0'); $p->set_weight('1'); $p->set_manage_stock($managed); if ($managed) $p->set_stock_quantity(50); $p->set_backorders('no'); $p->save(); $this->products[]=$p->get_id(); $this->data[$key]=$p->get_id();
  }
  $p=new WC_Product_Variable(); $p->set_name('Native parent '.$this->data['token']); $p->set_status('publish'); $p->set_manage_stock(true); $p->set_stock_quantity(50); $p->set_backorders('no'); $p->save(); $this->products[]=$p->get_id(); $this->data['parent']=$p->get_id();
  $this->data['children']=[];
  for($i=0;$i<2;++$i) {$v=new WC_Product_Variation();$v->set_parent_id($p->get_id());$v->set_status('publish');$v->set_regular_price('0');$v->set_weight('1');$v->set_manage_stock(false);$v->save();$this->products[]=$v->get_id();$this->data['children'][]=$v->get_id();}
  WC_Product_Variable::sync($p->get_id());
  $this->cart($this->data['simple']);
  $package=WC()->cart->get_shipping_packages()[0]; $mappings=[]; $this->data['capture_rates']=[];
  foreach (['wbs'=>Wbs\ShippingMethod::class,'wbsng'=>Aikinomi\Wbsng\ShippingMethod::class] as $provider=>$class) foreach ([0,$this->data['instances'][$provider]] as $id) {
   $rates=(new $class($id))->get_rates_for_package($package);$this->check(count($rates)===2,"Native $provider:$id offers Standard/Express");
   foreach ($rates as $rate) {
    $express=$rate->get_label()==='Express';$this->data['capture_rates'][]=$rate->get_id();
    $mappings[]=['methodId'=>$provider,'instanceId'=>$id,'mappingKind'=>'exact_rate','rateId'=>$rate->get_id(),'zoneId'=>$id?$zone->get_id():0,'zoneName'=>$id?'Native AU':'Global','title'=>$rate->get_label(),'enabled'=>true,'fulfilmentType'=>'delivery','minTransitDays'=>$express?1:4,'maxTransitDays'=>$express?2:6];
   }
  }
  foreach ($this->data['core'] as $i=>$row) if ($row['mapped']) {
   $mappings[]=['methodId'=>$row['method'],'instanceId'=>$row['instance'],'zoneId'=>$zone->get_id(),'zoneName'=>'Native AU','title'=>'Native '.$i,'enabled'=>true,'fulfilmentType'=>$row['method']==='local_pickup'?'collection':'delivery','minTransitDays'=>1,'maxTransitDays'=>2];
   if($i<2)$this->data['capture_rates'][]=$row['method'].':'.$row['instance'];
  }
  $this->data['settings']=['cutoffTime'=>'23:59','timezone'=>'Australia/Sydney','fallbackSupplierLeadTimeDays'=>5,'productionWeekdays'=>[0,1,2,3,4,5,6],'transitWeekdays'=>[0,1,2,3,4,5,6],'closures'=>[],'shippingMethods'=>$mappings,'defaultMethod'=>array_intersect_key($mappings[0],array_flip(['methodId','instanceId','mappingKind','rateId'])),'branding'=>['textColor'=>null,'accentColor'=>null,'backgroundColor'=>null,'fontSize'=>14,'spacing'=>'compact','showIcon'=>true]];
  $this->input('settings',0,['enabled'=>true,'settings'=>$this->data['settings']]);
  foreach (['simple','unmanaged','parent'] as $key) {
   $id=$this->data[$key];$children=$key==='parent'?$this->data['children']:[];
   $this->input('product',$id,['wooId'=>$id,'productionMinDays'=>1,'productionMaxDays'=>2,'variations'=>array_map(static fn($child)=>['wooId'=>$child,'productionMinDays'=>null,'productionMaxDays'=>null],$children)]);
   $this->input('inbound',$id,$this->inbound($id,$children?:[$id],$id));
  }
  $this->old_plugin='os-native-old-'.$this->data['token'];
  if (!symlink(__DIR__.'/old-plugin', WP_PLUGIN_DIR.'/'.$this->old_plugin)) throw new RuntimeException('Cannot create fixture plugin symlink');
  wp_clean_plugins_cache();
  $this->data['old_plugin']=$this->old_plugin.'/old-plugin.php';
  $this->save();
 }

 public function cart(int $product, int $quantity=2): void {
  if(!WC()->cart)wc_load_cart();
  WC()->cart->empty_cart();wc_clear_notices();
  WC()->customer->set_shipping_country('AU');WC()->customer->set_shipping_state('NSW');WC()->customer->set_shipping_postcode('2000');WC()->customer->set_calculated_shipping(true);
  WC()->cart->add_to_cart($product,$quantity);WC()->cart->calculate_totals();
 }

 public function save(): void { update_option('overseek_native_suite_'.$this->data['token'],$this->data,false); }

 /** Persist only test-owned cleanup state for an explicitly retained browser fixture. */
 public function ownership(): array {
  return ['data'=>$this->data,'options'=>$this->options,'products'=>$this->products,'pages'=>$this->pages,'zones'=>$this->zones,'zone_orders'=>$this->zone_orders,'users'=>$this->users,'triggers'=>$this->triggers,'original_user'=>$this->original_user,'old_plugin'=>$this->old_plugin];
 }

 public static function resume(array $state): self {
  self::guard();
  if (!is_array($state['data'] ?? null) || !preg_match('/\A[a-f0-9]{24}\z/',$state['data']['token'] ?? '') || get_option('overseek_account_id')!==($state['data']['account'] ?? null)) throw new RuntimeException('Retained fixture account no longer matches; refusing cleanup');
  $fixture=new self();
  foreach (['data','options','products','pages','zones','zone_orders','users','triggers','original_user','old_plugin'] as $field) $fixture->$field=$state[$field];
  return $fixture;
 }

 public function trigger(string $suffix, string $sql): string {
  global $wpdb;
  $name='os_native_'.substr($this->data['token'],0,12).'_'.$suffix;
  $this->check(false!==$wpdb->query(str_replace('{trigger}',$name,$sql)),'Create real SQL failure trigger '.$suffix);
  $this->triggers[]=$name;return $name;
 }

 public function drop_trigger(string $name): void {global $wpdb;$this->check(false!==$wpdb->query("DROP TRIGGER IF EXISTS `$name`"),'Drop fixture trigger');}

 public function cleanup(): array {
  global $wpdb;
  $errors=[];$try=static function(callable $fn)use(&$errors){try{$fn();}catch(Throwable $e){$errors[]=$e->getMessage();}};
  foreach($this->triggers as $name)$try(function()use($wpdb,$name){if(false===$wpdb->query("DROP TRIGGER IF EXISTS `$name`"))throw new RuntimeException('Trigger cleanup '.$name);});
  if(WC()->cart)WC()->cart->empty_cart();
  if(WC()->session && in_array((int)WC()->session->get_customer_id(),$this->users,true))WC()->session->destroy_session();
  $ledger=get_option('overseek_native_children_'.$this->data['token'],['orders'=>[],'sessions'=>[]]);
  // Child finally normally deletes these. The ledger also covers a child fatal/timeout.
  foreach(array_unique($ledger['orders']) as $id)$try(static function()use($id){$order=wc_get_order($id);if($order){wc_release_stock_for_order($order);$order->delete(true);}});
  foreach(array_unique(array_merge($ledger['sessions'],array_map('strval',$this->users))) as $key)$try(static function()use($wpdb,$key){if(false===$wpdb->delete($wpdb->prefix.'woocommerce_sessions',['session_key'=>$key]))throw new RuntimeException('Session cleanup failed');});
  delete_option('overseek_native_children_'.$this->data['token']);
  foreach(array_reverse($this->products) as $id)$try(static function()use($id){$p=wc_get_product($id);if($p)$p->delete(true);});
  foreach($this->pages as $id)$try(static fn()=>wp_delete_post($id,true));
  foreach($this->zones as $id)$try(static fn()=>(new WC_Shipping_Zone($id))->delete());
  foreach($this->zone_orders as $id=>$order)$try(static function()use($id,$order){$z=new WC_Shipping_Zone($id);$z->set_zone_order($order);$z->save();});
  foreach(['delivery_inputs','receipt_guards','receipt_journal','receipt_resolutions'] as $suffix)$try(function()use($wpdb,$suffix){$table=$wpdb->prefix.'overseek_'.$suffix;if($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($table)))){if(false===$wpdb->query($wpdb->prepare("DELETE FROM `$table` WHERE account_id=%s",$this->data['account'])))throw new RuntimeException('Account fixture cleanup '.$suffix);}});
  delete_transient('overseek_delivery_options_'.md5($this->data['account']));
  delete_option('overseek_native_suite_'.$this->data['token']);
  require_once ABSPATH.'wp-admin/includes/user.php';
  wp_set_current_user($this->original_user);
  foreach($this->users as $id)$try(static fn()=>wp_delete_user($id));
  foreach($this->options as $name=>$original)$try(static function()use($name,$original){if($original['exists'])update_option($name,$original['value']);else delete_option($name);});
  // Restore generation last: restoring page/plugin options may legitimately invalidate it.
  if(isset($this->options['overseek_delivery_environment_generation'])){$o=$this->options['overseek_delivery_environment_generation'];if($o['exists'])update_option('overseek_delivery_environment_generation',$o['value']);else delete_option('overseek_delivery_environment_generation');}
  if($this->old_plugin && is_link(WP_PLUGIN_DIR.'/'.$this->old_plugin))unlink(WP_PLUGIN_DIR.'/'.$this->old_plugin);
  wp_clean_plugins_cache();
  remove_filter('pre_http_request',$this->deny_http,PHP_INT_MAX);remove_filter('pre_wp_mail',$this->deny_mail,PHP_INT_MAX);
  return $errors;
 }
}
