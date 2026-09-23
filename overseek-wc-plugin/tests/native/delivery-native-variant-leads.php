<?php
/** Native REST + Woo owner regression; owned disposable fixture lifecycle only. */
declare(strict_types=1);

function overseek_native_variant_leads(OverSeek_Native_Fixture $f, WC_Shipping_Rate $rate): void {
 $d=$f->data; $storage=new OverSeek_Delivery_Input_Storage();
 $saved=$storage->read_inbound($d['parent'])['payload'];
 $settings=$storage->read_settings()['payload'];
 $production=$storage->read_product($d['parent'])['payload'];
 $owner=wc_get_product($d['parent']); $stock=$owner->get_stock_quantity(); $backorders=$owner->get_backorders();
 try {
  $caps=$f->request('capabilities',[],200,'GET');
  $f->check(($caps['capabilities']['variantSupplierLeads']??false)===true,'Native discovery advertises variantSupplierLeads');
  $f->check(OverSeek_Delivery_Storefront_Gate::is_active(),'Native variant suite starts behind real activated control');
  $owner->set_backorders('yes'); $owner->save(); wc_update_product_stock($owner,0,'set');
  // Remap the shared real-producer envelope to fixture-owned native IDs/proof/time.
  $wire=json_decode(file_get_contents(__DIR__.'/../../../packages/overseek-core/test-fixtures/delivery-variant-supplier-leads-v1.json'),true,32,JSON_THROW_ON_ERROR);
  $payload=$saved; $payload['targets']=$wire['payload']['targets'];
  $ids=[10=>$d['parent'],11=>$d['children'][0],12=>$d['children'][1]];
  foreach($payload['targets'] as &$target){$target['wooId']=$ids[$target['wooId']];if($target['stockOwnerWooId']!==null)$target['stockOwnerWooId']=$ids[$target['stockOwnerWooId']];$target['batches']=[];} unset($target);
  $custom=$production;
  $custom['variations']=[['wooId'=>$d['children'][0],'productionMinDays'=>0,'productionMaxDays'=>1],['wooId'=>$d['children'][1],'productionMinDays'=>3,'productionMaxDays'=>5]];
  $f->input('product',$d['parent'],$custom);
  $f->input('inbound',$d['parent'],$payload);
  $adapter=new OverSeek_Delivery_Live_Adapter(); $now=new DateTimeImmutable('now',new DateTimeZone('UTC'));
  $lines=array_map(static fn($id)=>['product_id'=>$d['parent'],'variation_id'=>$id,'quantity'=>2,'data'=>wc_get_product($id)],$d['children']);
  foreach($lines as $line)$f->check($line['data']->managing_stock()==='parent' && $line['data']->get_stock_managed_by_id()===$d['parent'],'Native variation inherits the single physical parent owner');
  $fast=$adapter->calculate([$lines[0]],[$rate],$now); $full=$adapter->calculate($lines,[$rate],$now);
  $f->check($fast['status']==='available' && $full['status']==='available','Native REST accepts variant supplier overrides for inherited owner');
  $day=static fn(int $offset)=>(new DateTimeImmutable($fast['effective_date'],new DateTimeZone('UTC')))->modify("+$offset days")->format('Y-m-d');
  $expect=static function(array $result,int $min,int $max,string $label)use($f,$day):void{
   $f->check($result['status']==='available' && $result['readiness']===['min'=>$day($min),'max'=>$day($max)],$label.'; actual '.wp_json_encode($result));
  };
  $expect($fast,2,5,'Native fast preview uses only A lead 2..4 plus A production 0..1');
  $expect($full,10,15,'Native full cart uses lead 7..10 and whole-order production 3..5');
  $f->check($full===$adapter->calculate(array_reverse($lines),[$rate],$now),'Native cart lead selection independent of order');

  $changed=$settings;$changed['settings']['fallbackSupplierLeadTimeDays']=30;
  $f->input('settings',0,$changed);$f->activate();
  $payload['targets'][1]['supplierLead']=null;$f->input('inbound',$d['parent'],$payload);
  $expect($adapter->calculate([$lines[0]],[$rate],$now),30,31,'Native null target uses configured thirty-day fallback');
  $expect($adapter->calculate($lines,[$rate],$now),33,35,'Native null target contributes fallback to shared-cart maximum');
  $f->check($adapter->calculate($lines,[$rate],$now)===$adapter->calculate(array_reverse($lines),[$rate],$now),'Native null lead aggregation is order independent');
  $changed['settings']['fallbackSupplierLeadTimeDays']=0;$f->input('settings',0,$changed);$f->activate();
  $expect($adapter->calculate([$lines[0]],[$rate],$now),0,1,'Native null target respects explicit configured zero');
  $changed['settings']['fallbackSupplierLeadTimeDays']=30;$f->input('settings',0,$changed);$f->activate();
  $payload['targets'][1]['supplierLead']=['min'=>0,'max'=>0];$f->input('inbound',$d['parent'],$payload);
  $expect($adapter->calculate([$lines[0]],[$rate],$now),0,1,'Native valid zero target lead does not become fallback');

  $payload['targets'][1]['supplierLead']=['min'=>2,'max'=>4];
  foreach([1,2] as $i)$payload['targets'][$i]['batches']=[['dueDate'=>$day(1),'quantity'=>4]];
  $f->input('inbound',$d['parent'],$payload);
  $expect($adapter->calculate($lines,[$rate],$now),4,6,'Native four dated units cover four cart units before supplier fallback');
  foreach([1,2] as $i)$payload['targets'][$i]['batches'][0]['quantity']=3;
  $f->input('inbound',$d['parent'],$payload);
  $expect($adapter->calculate($lines,[$rate],$now),10,15,'Native shared three-unit batch counted once cannot cover four cart units');
  wc_update_product_stock($owner,1,'set');
  $five=$lines;$five[1]['quantity']=3;
  $expect($adapter->calculate($five,[$rate],$now),10,15,'Native stock unit counted once with shared three-unit batch cannot cover five');
  wc_update_product_stock($owner,0,'set');

  $invalid=static function(array $bad,string $reason,string $scope='inbound')use($f,$d):void{
   $response=$f->input($scope,$d['parent'],$bad,400);
   $f->check($response['code']==='overseek_delivery_input_invalid' && $response['message']==='Invalid delivery input.' && $response['data']===['status'=>400,'reason'=>$reason],'Native REST exact safe reason '.$reason);
  };
  $bad=$payload;$bad['targets'][2]['batches'][0]['quantity']=99;$invalid($bad,'owner_pool_batches_mismatch');
  $bad=$payload;$bad['generatedAt']=$now->modify('-25 hours')->format('Y-m-d\TH:i:s\Z');$bad['expiresAt']=$now->modify('-1 hour')->format('Y-m-d\TH:i:s\Z');$invalid($bad,'inbound_expired');
  $bad=$payload;$bad['generatedAt']=$now->modify('+10 minutes')->format('Y-m-d\TH:i:s\Z');$bad['expiresAt']=$now->modify('+1450 minutes')->format('Y-m-d\TH:i:s\Z');$invalid($bad,'inbound_generated_in_future');
  $bad=$payload;$bad['expiresAt']=(new DateTimeImmutable($bad['generatedAt']))->modify('+23 hours')->format('Y-m-d\TH:i:s\Z');$invalid($bad,'inbound_ttl_invalid');
  $bad=$payload;$bad['targets'][1]['supplierLead']=['min'=>4,'max'=>2];$invalid($bad,'supplier_lead_invalid');
  $bad=$payload;$bad['targets'][1]['stockOwnerWooId']=$d['children'][0];$invalid($bad,'stock_owner_mismatch');
  $bad=$custom;$bad['variations'][0]['productionMinDays']=2;$bad['variations'][0]['productionMaxDays']=1;$invalid($bad,'production_range_invalid','product');
  $bad=$payload;$bad['SECRET']='SECRET';$invalid($bad,'schema_invalid');
  $bad=$payload;$bad['targets']=array_fill(0,1002,$payload['targets'][1]);$invalid($bad,'payload_limits_exceeded');
  $request=new WP_REST_Request('POST','/overseek/v1/delivery-estimates/inputs');
  $request->set_header('x-overseek-account-id',$d['account']);$request->set_body(str_repeat(' ',512*1024+1));
  $response=rest_do_request($request);
  $f->check($response->get_status()===413 && $response->get_data()===['code'=>'overseek_delivery_input_too_large','message'=>'Delivery input exceeds the size limit.','data'=>['status'=>413,'reason'=>'payload_limits_exceeded']],'Native oversized body preserves HTTP 413 code and safe payload_limits_exceeded reason');

  $op=$f->operation($d['parent'],1,$d['children'][0],$d['parent']);$f->receipt('prepare',$op,'prepared');
  $f->check($adapter->calculate($lines,[$rate],$now)===['status'=>'unavailable','reason'=>'receipt_guard_pending'],'Native pending owner guard blanks differing-lead cart');
  $f->receipt('apply',$op,'applied');
  $f->check($adapter->calculate([$lines[0]],[$rate],$now)===['status'=>'unavailable','reason'=>'receipt_guard_pending'],'Native applied guard still blanks fast preview until proof');
  $guard=(new OverSeek_Receipt_Storage())->guard($d['account'],$d['parent']);
  $payload['receiptProof']['owners']=[['stockOwnerWooId'=>$d['parent'],'sequence'=>(int)$guard['sequence'],'operationId'=>$guard['operation_id']]];
  $f->input('inbound',$d['parent'],$payload);
  $expect($adapter->calculate($lines,[$rate],$now),4,6,'Native matching receipt proof releases guard and pooled supply restores dated estimate');
 } finally {
  $owner->set_backorders($backorders);$owner->save();wc_update_product_stock($owner,$stock,'set');
  $guard=(new OverSeek_Receipt_Storage())->guard($d['account'],$d['parent']);
  $saved['receiptProof']['owners']=[['stockOwnerWooId'=>$d['parent'],'sequence'=>(int)$guard['sequence'],'operationId'=>$guard['operation_id']]];
  $f->input('inbound',$d['parent'],$saved);
  $f->input('product',$d['parent'],$production);
  $f->input('settings',0,$settings);$f->activate();
 }
}
