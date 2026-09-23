<?php
/** Crash-recoverable ownership ledger for aggregate-created orders/sessions. @package OverSeek */
declare(strict_types=1);

function overseek_native_track_child(string $token): void {
 $key='overseek_native_children_'.$token;
 add_action('woocommerce_new_order',static function($id)use($key):void{
  $ledger=get_option($key,['orders'=>[],'sessions'=>[]]);$ledger['orders'][]=(int)$id;
  update_option($key,$ledger,false);
 },PHP_INT_MAX,1);
 register_shutdown_function(static function()use($key):void{
  if(!function_exists('WC')||!WC()->session)return;
  $session=(string)WC()->session->get_customer_id();
  if($session==='')return;
  $ledger=get_option($key,['orders'=>[],'sessions'=>[]]);$ledger['sessions'][]=$session;
  $ledger['sessions']=array_values(array_unique($ledger['sessions']));update_option($key,$ledger,false);
 });
}
