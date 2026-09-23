<?php
/** Verify native tests load the installed plugin, optionally byte-for-byte from a release ZIP. */
declare(strict_types=1);

function overseek_native_installed_code(): array {
 if (!defined('OVERSEEK_WC_PLUGIN_DIR') || !defined('OVERSEEK_WC_VERSION')) throw new RuntimeException('Activate the installed OverSeek plugin first.');
 $root=realpath(OVERSEEK_WC_PLUGIN_DIR);
 $installed=WP_PLUGIN_DIR.'/overseek-wc-plugin';
 if (!$root || realpath($installed)!==$root) throw new RuntimeException('Unexpected installed plugin root.');
 $expected=getenv('OVERSEEK_NATIVE_EXPECT_VERSION');
 if ($expected!==false && $expected!=='' && OVERSEEK_WC_VERSION!==$expected) throw new RuntimeException('Installed plugin version mismatch.');
 $archive=getenv('OVERSEEK_NATIVE_ARTIFACT_ZIP');$digest=getenv('OVERSEEK_NATIVE_ARTIFACT_SHA256');$zip=null;
 if ($archive) {
  if (is_link($installed)) throw new RuntimeException('Release verification refuses a workspace plugin symlink.');
  if (!is_string($digest)||!preg_match('/\A[a-f0-9]{64}\z/',$digest)||!hash_equals($digest,hash_file('sha256',$archive))) throw new RuntimeException('Release ZIP digest mismatch.');
  $zip=new ZipArchive();if($zip->open($archive,ZipArchive::RDONLY)!==true)throw new RuntimeException('Cannot inspect release ZIP.');
  if(is_dir($root.'/tests'))throw new RuntimeException('Release installation unexpectedly contains test helpers.');
 }
 // REST classes are lazy-loaded by native bootstrap; loading their definitions here
 // verifies provenance without registering or replacing any route/callback.
 foreach (['delivery-storefront-context','delivery-order-snapshot','delivery-checkout-capture','delivery-product-service','receipt-api','receipt-validation','receipt-write-observer','receipt-reconciliation'] as $name) require_once $root.'/includes/class-overseek-'.$name.'.php';
 $classes=[];$files=[];
 try {
  foreach(get_declared_classes() as $class) {
   if(!str_starts_with(strtolower($class),'overseek_')||$class==='OverSeek_Native_Fixture')continue;
   $file=realpath((new ReflectionClass($class))->getFileName());
   if(!$file||!str_starts_with($file,$root.DIRECTORY_SEPARATOR))throw new RuntimeException('Workspace/stub production class detected: '.$class.' '.$file);
   $classes[$class]=$file;
  }
  foreach(get_included_files() as $file) {
   $file=realpath($file);
   if(!$file||!str_starts_with($file,$root.DIRECTORY_SEPARATOR))continue;
   $relative=substr($file,strlen($root)+1);$files[$relative]=hash_file('sha256',$file);
   if($zip){$bytes=$zip->getFromName('overseek-wc-plugin/'.$relative);if($bytes===false||!hash_equals(hash('sha256',$bytes),$files[$relative]))throw new RuntimeException('Installed runtime differs from ZIP: '.$relative);}
  }
  foreach(['OverSeek_Receipt_API','OverSeek_Receipt_Storage','OverSeek_Receipt_Write_Observer','OverSeek_Delivery_Control','OverSeek_Delivery_Storefront_Gate','OverSeek_Delivery_Live_Adapter','OverSeek_Delivery_Checkout_Capture'] as $required)if(!isset($classes[$required]))throw new RuntimeException('Missing installed class provenance: '.$required);
 }finally{if($zip)$zip->close();}
 ksort($classes);ksort($files);
 return ['version'=>OVERSEEK_WC_VERSION,'root'=>$root,'symlink'=>is_link($installed),'archive'=>$archive?:null,'sha256'=>$archive?$digest:null,'classes'=>$classes,'loadedFileHashes'=>$files];
}
