<?php
/** Real control, proof publication and receipt failures. Included by aggregate only. @package OverSeek */
declare(strict_types=1);

function overseek_native_protocol(OverSeek_Native_Fixture $f): void {
 global $wpdb;
 $d=$f->data;$storage=new OverSeek_Delivery_Input_Storage();$receipts=new OverSeek_Receipt_Storage();
 wp_set_current_user(0);$f->request('control',[],401,'GET');wp_set_current_user($d['manager']);
 $f->request('control',[],403,'GET','wrong-account');$f->request('control',[],200,'GET');
 $f->check(has_action('woocommerce_checkout_order_processed',['OverSeek_Delivery_Checkout_Capture','classic'])!==false && has_action('woocommerce_store_api_checkout_order_processed',['OverSeek_Delivery_Checkout_Capture','blocks'])!==false,'Production bootstrap registered both checkout capture callbacks');
 $f->check(!OverSeek_Delivery_Storefront_Gate::is_active(),'Fresh synced account remains inactive');
 $rate=new WC_Shipping_Rate($d['capture_rates'][0],'Standard',0,[],'wbs',0);
 $cart=[['product_id'=>$d['simple'],'variation_id'=>0,'quantity'=>2,'data'=>wc_get_product($d['simple'])]];
 $adapter=new OverSeek_Delivery_Live_Adapter();
 $f->check($adapter->calculate($cart,[$rate])['status']==='unavailable','Unverified inbound suppresses managed dates');
 $f->check(!is_wp_error(activate_plugin($d['old_plugin'])),'Activate inert real old-plugin header fixture');
 $f->control('baseline',['owners'=>[$d['simple'],$d['unmanaged'],$d['parent']]]);$f->control('guarded');
 $blocked=$f->control('activate',['settingsRevision'=>$storage->read_settings()['revision']],409);
 $f->check(str_contains(wp_json_encode($blocked),'deactivate_old_delivery_plugin'),'Old plugin allows private baseline/guarded preparation but refuses activation');
 deactivate_plugins($d['old_plugin']);
 $f->check(!OverSeek_Delivery_Storefront_Gate::is_active(),'Guarded cutover does not activate');
 foreach(['simple','unmanaged','parent'] as $key){$id=$d[$key];$f->publish($id,$key==='parent'?$d['children']:[$id],$id);}
 $f->activate();
 $f->check($adapter->calculate($cart,[$rate])['status']==='available','Verified managed native estimate available');
 $siblings=array_map(static fn($id)=>['product_id'=>$d['parent'],'variation_id'=>$id,'quantity'=>2,'data'=>wc_get_product($id)],$d['children']);
 $f->check(wc_get_product($d['children'][0])->managing_stock()==='parent','Fixture uses native inherited managing_stock sentinel');
 $f->check($adapter->calculate($siblings,[$rate])['status']==='available','Both parent-managed siblings receive valid pooled estimate');
 foreach([[$d['simple'],null,$cart,[$d['simple']]],[$d['parent'],$d['children'][0],$siblings,$d['children']]] as [$owner,$variation,$lines,$targets]) {
  $writes=0;$count=static function($sql,$id)use(&$writes,$owner){if((int)$id===$owner)++$writes;return $sql;};add_filter('woocommerce_update_product_stock_query',$count,10,2);
  try {
   $before=(int)$wpdb->get_var($wpdb->prepare("SELECT meta_value FROM {$wpdb->postmeta} WHERE post_id=%d AND meta_key='_stock'",$owner));
   $old=$storage->read_inbound($owner)['payload'];
   foreach([3,-3] as $delta){
    $op=$f->operation($owner,$delta,$variation,$owner);$f->receipt('prepare',$op,'prepared');
    $f->check($adapter->calculate($lines,[$rate])['status']==='unavailable',"Owner $owner prepare guard suppresses dates");
    $ack=$f->receipt('apply',$op,'applied');$f->receipt('apply',$op,'applied');
    $f->check($adapter->calculate($lines,[$rate])['status']==='unavailable','Applied guard remains pending until proof');
    $stale=$f->input('inbound',$owner,$old,409);$f->check($stale['code']==='overseek_delivery_stale_proof','Old proof rejected without releasing newer guard');
    $f->publish($owner,$targets,$owner);$f->check($adapter->calculate($lines,[$rate])['status']==='available','Matching proof restores dates');
   }
   $f->check($writes===2,'Receipt plus reversal each issue exactly one native stock UPDATE');
   $f->check((int)$ack['stockQuantity']===$before,'Reversal restores original owner stock');
  } finally {remove_filter('woocommerce_update_product_stock_query',$count,10);}
 }
 $f->check(wc_get_product($d['children'][0])->get_manage_stock('edit')===false,'Receipt flow leaves native variation inheritance intact');
 $id=$d['simple'];$op=$f->operation($id,3);$f->receipt('prepare',$op,'prepared');
 $name=$f->trigger('stock',"CREATE TRIGGER {trigger} BEFORE UPDATE ON {$wpdb->postmeta} FOR EACH ROW BEGIN IF OLD.post_id=$id AND OLD.meta_key='_stock' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='native forced stock failure'; END IF; END");
 try{$f->receipt('apply',$op,'uncertain');}finally{$f->drop_trigger($name);}
 $before=wc_get_product($id)->get_stock_quantity();$f->receipt('apply',$op,'uncertain');
 $f->check(wc_get_product($id)->get_stock_quantity()===$before,'Uncertain retry never repeats delta');
 $obs=$f->request('receipts/observe',['operation'=>$op]);wc_update_product_stock($id,(int)$obs['stockQuantity']+3,'set');
 $body=['operation'=>$op,'actionId'=>'resolve_'.bin2hex(random_bytes(6)),'actorId'=>(string)$d['manager'],'reason'=>'Native operator corrected count including operation, excluding later queued stock.','correctedCountIncludesOperation'=>true,'observedStockQuantity'=>$obs['stockQuantity'],'observationToken'=>$obs['observationToken']];
 $f->request('receipts/reconcile',$body,409);$obs=$f->request('receipts/observe',['operation'=>$op]);$body['observationToken']=$obs['observationToken'];$body['observedStockQuantity']=$obs['stockQuantity'];
 $ack=$f->request('receipts/reconcile',$body);$f->check($ack['state']==='reconciled','Real operator attestation reconciles SQL uncertainty');$f->check($f->request('receipts/reconcile',$body)===$ack,'Lost reconciliation ACK replays identically');
 $f->publish($id,[$id],$id);
 $next=$f->operation($id,-3);$f->receipt('prepare',$next,'prepared');$f->receipt('apply',$next,'applied');
 $proof=$f->inbound($id,[$id],$id,[['stockOwnerWooId'=>$id,'sequence'=>$next['sequence'],'operationId'=>$next['operationId']]]);
 // A second real MySQL connection contends on the production physical-owner lock.
 $other=new wpdb(DB_USER,DB_PASSWORD,DB_NAME,DB_HOST);
 $lock='osreceipt:'.substr(hash('sha256',$wpdb->prefix.'overseek_receipt_:owner:'.$id),0,54);
 $f->check('1'===(string)$other->get_var($other->prepare('SELECT GET_LOCK(%s,0)',$lock)),'Second native connection acquired physical-owner lock');
 try{$conflict=$f->input('inbound',$id,$proof,409);$f->check($conflict['code']==='overseek_delivery_stale_proof','Concurrent finalizer refuses locked owner without releasing guard');}
 finally{$other->get_var($other->prepare('SELECT RELEASE_LOCK(%s)',$lock));$other->close();}
 // Force failure after input UPDATE and during guard release; neither can commit alone.
 $old=$storage->read_inbound($id);
 $name=$f->trigger('release',"CREATE TRIGGER {trigger} AFTER UPDATE ON {$wpdb->prefix}overseek_receipt_guards FOR EACH ROW BEGIN IF NEW.owner_id=$id AND NEW.guard_active=0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='native release failure'; END IF; END");
 try{$f->input('inbound',$id,$proof,503);}finally{$f->drop_trigger($name);}
 $f->check($storage->read_inbound($id)['revision']===$old['revision']&&(int)$receipts->guard($d['account'],$id)['guard_active']===1,'Real transaction rolls back input publish and guard release');
 $f->input('inbound',$id,$proof);
 $f->check($adapter->calculate($cart,[$rate],new DateTimeImmutable('+25 hours',new DateTimeZone('UTC')))['status']==='unavailable','Expired proof input unavailable');
 $f->control('disable');$f->check($storage->read_settings()['payload']['enabled']===true,'Explicit disable tested while settings remain enabled');
 $f->check(!OverSeek_Delivery_Storefront_Gate::is_active(),'Explicit disable closes gate independently of enabled settings');
 $f->activate();activate_plugin($d['old_plugin']);$f->check(!OverSeek_Delivery_Storefront_Gate::is_active(),'Old-plugin fingerprint invalidates already-active gate');
 $f->control('disable');deactivate_plugins($d['old_plugin']);$f->activate();
 $f->save();
}
