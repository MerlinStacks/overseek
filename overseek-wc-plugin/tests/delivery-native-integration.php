<?php
/** Aggregate native Woo/WBS/MySQL launch suite. See delivery-native-integration.md. @package OverSeek */
declare(strict_types=1);

require_once __DIR__.'/native/class-delivery-native-fixture.php';
OverSeek_Native_Fixture::guard();
if (!defined('WP_HTTP_BLOCK_EXTERNAL') || !WP_HTTP_BLOCK_EXTERNAL || !defined('DISABLE_WP_CRON') || !DISABLE_WP_CRON) throw new RuntimeException('Configure WP_HTTP_BLOCK_EXTERNAL and DISABLE_WP_CRON in disposable wp-config before testing.');
error_reporting(E_ALL & ~E_DEPRECATED);
$artifact_parent=realpath(getenv('OVERSEEK_NATIVE_ARTIFACT_DIR') ?: sys_get_temp_dir());
if(!$artifact_parent||!is_dir($artifact_parent)||!is_writable($artifact_parent))throw new RuntimeException('Artifact parent must already exist and be writable');
$artifacts=$artifact_parent.'/overseek-native-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(4));
if(!mkdir($artifacts,0700))throw new RuntimeException('Cannot create native artifact directory');
$f=new OverSeek_Native_Fixture();$failures=[];$runs=[];$setup=false;
$old_env=[];foreach(['OVERSEEK_NATIVE_CHILD_TOKEN','OVERSEEK_NATIVE_SNAPSHOTS','OVERSEEK_CHECKOUT_PRODUCT_ID','OVERSEEK_CHECKOUT_RATE_ID'] as $key)$old_env[$key]=getenv($key);
$run=static function(string $name,array $command)use(&$runs,&$failures,$artifacts):void{
 $path=$artifacts.'/'.$name.'.log';
 $process=proc_open($command,[0=>['file','/dev/null','r'],1=>['file',$path,'w'],2=>['file',$path,'a']],$pipes,ABSPATH);
 if(!is_resource($process))throw new RuntimeException('Cannot launch '.$name);
 $start=microtime(true);$timed_out=false;
 do{$state=proc_get_status($process);if(!$state['running'])break;if(microtime(true)-$start>180){$timed_out=true;proc_terminate($process);break;}usleep(100000);}while(true);
 $closed=proc_close($process);$exit=$state['exitcode']>=0?$state['exitcode']:$closed;$output=file_get_contents($path);
 // Some WP-CLI error handlers have returned zero after a fatal; require positive completion evidence.
 $complete=str_starts_with($name,'render-')?str_contains($output,'NATIVE_RENDER_SUCCESS'):($name==='legacy-receipts'?str_contains($output,'assertions passed; fixtures cleaned up.'):str_contains($output,'Native capture:'));
 $ok=!$timed_out&&$exit===0&&!preg_match('/Fatal error:|^Error:|Uncaught /m',$output)&&$complete&&(str_starts_with($name,'render-')||str_contains($output,'NATIVE_BOOTSTRAP_CAPTURE_OK'));
 $runs[]=['name'=>$name,'passed'=>$ok,'exit'=>$exit,'seconds'=>round(microtime(true)-$start,3),'log'=>$path];
 WP_CLI::log(($ok?'PASS ':'FAIL ').$name.' '.$path);
 if(!$ok)$failures[]=$name.' failed; '.$path;
};
try {
 $f->setup();$setup=true;
 require_once __DIR__.'/native/delivery-native-protocol.php';
 try {overseek_native_protocol($f);}catch(Throwable $error){$failures[]='protocol: '.$error->getMessage();WP_CLI::warning(end($failures));}
 if(!OverSeek_Delivery_Storefront_Gate::is_active())throw new RuntimeException('Native control failed to activate; refusing downstream gate bypass');
 putenv('OVERSEEK_NATIVE_CHILD_TOKEN='.$f->data['token']);putenv('OVERSEEK_NATIVE_SNAPSHOTS='.$artifacts.'/native-snapshots.jsonl');
 foreach(['classic','blocks'] as $mode)$run('render-'.$mode,[PHP_BINARY,'-d','sendmail_path=/bin/true',__DIR__.'/native/delivery-native-render-child.php',ABSPATH,$mode]);
 // Execute the original, unchanged capture harness as the WP-CLI target (no wrapper).
 $cli=$_SERVER['argv'][0];
 if(!is_file($cli))throw new RuntimeException('Cannot resolve WP-CLI executable for checkout subprocesses');
 $run('legacy-receipts',[PHP_BINARY,'-d','sendmail_path=/bin/true',$cli,'--path='.ABSPATH,'--require='.__DIR__.'/native/delivery-native-cli-preload.php','eval-file',__DIR__.'/delivery-receipts-integration.php','--use-include']);
 foreach(['no','yes'] as $hpos){
  $f->option('woocommerce_custom_orders_table_enabled',$hpos);
  foreach(['unmanaged','simple'] as $product){
   foreach($f->data['capture_rates'] as $index=>$rate){
    putenv('OVERSEEK_CHECKOUT_PRODUCT_ID='.$f->data[$product]);putenv('OVERSEEK_CHECKOUT_RATE_ID='.$rate);
    $run('capture-'.$hpos.'-'.$product.'-'.$index,[PHP_BINARY,'-d','sendmail_path=/bin/true',$cli,'--path='.ABSPATH,'--require='.__DIR__.'/native/delivery-native-cli-preload.php','eval-file',__DIR__.'/delivery-checkout-capture-integration.php','--use-include']);
   }
  }
 }
  require_once OVERSEEK_WC_PLUGIN_DIR.'includes/class-overseek-delivery-order-snapshot.php';
 $native=is_file($artifacts.'/native-snapshots.jsonl')?file($artifacts.'/native-snapshots.jsonl',FILE_IGNORE_NEW_LINES|FILE_SKIP_EMPTY_LINES):[];
 $f->check(count($native)===80,'All forty native capture runs exported classic and Blocks saved snapshots');
 foreach($native as $line){$row=json_decode($line,true,32,JSON_THROW_ON_ERROR);$f->check(OverSeek_Delivery_Order_Snapshot::parse($row['snapshot'])===$row['snapshot'],'Native saved snapshot PHP round trip');}
 $shared=json_decode(file_get_contents(__DIR__.'/../../packages/overseek-core/test-fixtures/delivery-estimate-snapshot-v1.json'),true,32,JSON_THROW_ON_ERROR);
 foreach($shared['cases'] as $case)$f->check((OverSeek_Delivery_Order_Snapshot::parse($case['snapshot'])!==null)===$case['valid'],'Shared snapshot fixture '.$case['name']);
}catch(Throwable $error){$failures[]=$error->getMessage();WP_CLI::warning($error->getMessage());}
finally {
 $cleanup=$f->cleanup();foreach($cleanup as $error)$failures[]='cleanup: '.$error;
 foreach($old_env as $key=>$value)putenv($value===false?$key:$key.'='.$value);
  $provenance=overseek_native_installed_code();
  $summary=['versions'=>['plugin'=>OVERSEEK_WC_VERSION,'wordpress'=>get_bloginfo('version'),'woocommerce'=>WC_VERSION,'wbs'=>(string)Wbs\Plugin::instance()->meta->version,'php'=>PHP_VERSION,'mysql'=>$GLOBALS['wpdb']->get_var('SELECT VERSION()')],'provenance'=>$provenance,'checks'=>$f->checks,'runs'=>$runs,'failures'=>$failures,'cleanupErrors'=>$cleanup,'artifacts'=>$artifacts];
 file_put_contents($artifacts.'/results.json',wp_json_encode($summary,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
 WP_CLI::log('Native artifacts: '.$artifacts);
}
if($failures)WP_CLI::error(implode("\n",$failures));
WP_CLI::success('Native launch aggregate passed; owned fixtures cleaned up.');
