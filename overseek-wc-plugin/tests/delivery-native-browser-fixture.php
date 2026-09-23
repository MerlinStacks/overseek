<?php
/** Explicitly retained public browser fixture; setup/cleanup via disposable WP-CLI only. */
declare(strict_types=1);
require_once __DIR__.'/native/class-delivery-native-fixture.php';
OverSeek_Native_Fixture::guard();
error_reporting(E_ALL & ~E_DEPRECATED);
$directory=realpath(getenv('OVERSEEK_NATIVE_BROWSER_DIR') ?: '');
if(!$directory||!is_dir($directory)||!is_writable($directory))throw new RuntimeException('Supply existing OVERSEEK_NATIVE_BROWSER_DIR');
$manifest=$directory.'/fixture.json';
if(getenv('OVERSEEK_NATIVE_BROWSER_ACTION')==='cleanup') {
 $saved=json_decode(file_get_contents($manifest),true,64,JSON_THROW_ON_ERROR);
 $fixture=OverSeek_Native_Fixture::resume($saved['ownership']);$errors=$fixture->cleanup();
 if(is_link($saved['themeLink']))unlink($saved['themeLink']);
 if(is_link($saved['probeLink']))unlink($saved['probeLink']);
 wp_clean_themes_cache();
 if($errors)WP_CLI::error(implode('; ',$errors));
 unlink($manifest);WP_CLI::success('Owned browser fixture removed; site URL/theme and prior configuration restored.');return;
}
if(is_file($manifest))throw new RuntimeException('Retained fixture exists; reuse it or explicitly clean it first.');
$origin=getenv('OVERSEEK_NATIVE_BROWSER_ORIGIN');
if(!is_string($origin)||!preg_match('~\Ahttp://127\.0\.0\.1:([1-9][0-9]{3,4})\z~',$origin,$match)||(int)$match[1]>65535)throw new RuntimeException('Use a custom loopback-only HTTP port');
$fixture=new OverSeek_Native_Fixture();$theme_link='';$probe_link='';
try {
 $fixture->setup();
 $fixture->option('home',$origin);$fixture->option('siteurl',$origin);
 $fixture->option('overseek_native_browser_probe',['token'=>$fixture->data['token'],'log'=>$directory.'/server-events.jsonl']);
 $probe_link=WP_CONTENT_DIR.'/mu-plugins/os-native-browser-probe-'.$fixture->data['token'].'.php';
 if(!symlink(__DIR__.'/native/delivery-native-browser-probe.php',$probe_link))throw new RuntimeException('Cannot link private browser probe');
 $theme='os-native-browser-'.$fixture->data['token'];$theme_link=WP_CONTENT_DIR.'/themes/'.$theme;
 if(!symlink(__DIR__.'/native/browser-theme',$theme_link))throw new RuntimeException('Cannot link fixture theme');
 foreach(['template','stylesheet'] as $key)$fixture->option($key,$theme);
 $fixture->option('current_theme','OverSeek Native Browser Fixture');wp_clean_themes_cache();
 $parent=wc_get_product($fixture->data['parent']);
 $attribute=new WC_Product_Attribute();$attribute->set_name('Size');$attribute->set_options(['Small','Large']);$attribute->set_visible(true);$attribute->set_variation(true);
 $parent->set_attributes([$attribute]);$parent->save();
 foreach($fixture->data['children'] as $i=>$id){$v=wc_get_product($id);$v->set_attributes(['size'=>$i===0?'Small':'Large']);$v->save();}
 WC_Product_Variable::sync($parent->get_id());
 foreach(['simple','parent'] as $key){$p=wc_get_product($fixture->data[$key]);$p->set_name($key==='simple'?'Native Simple Product':'Native Variable Product');$p->set_description('<section class="placement"><div class="fixture-label">Shortcode placement</div>[overseek_delivery_estimate product_id="'.$p->get_id().'"]</section><section class="placement"><div class="fixture-label">Dynamic block placement</div><!-- wp:overseek/delivery-estimate {"productId":'.$p->get_id().'} /--></section>');$p->save();}
 $fixture->control('baseline',['owners'=>[$fixture->data['simple'],$fixture->data['unmanaged'],$fixture->data['parent']]]);$fixture->control('guarded');
 foreach(['simple','unmanaged','parent'] as $key){$id=$fixture->data[$key];$fixture->publish($id,$key==='parent'?$fixture->data['children']:[$id],$id);}
 $fixture->activate();$fixture->save();
 $saved=['origin'=>$origin,'simpleUrl'=>get_permalink($fixture->data['simple']),'variableUrl'=>get_permalink($fixture->data['parent']),'themeLink'=>$theme_link,'probeLink'=>$probe_link,'wpRoot'=>ABSPATH,'ownership'=>$fixture->ownership(),'createdAt'=>gmdate('c')];
 if(false===file_put_contents($manifest,wp_json_encode($saved,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)))throw new RuntimeException('Cannot persist browser fixture ownership');
 WP_CLI::success('Retained real active browser fixture: '.$manifest);
 WP_CLI::log(wp_json_encode(['simple'=>$saved['simpleUrl'],'variable'=>$saved['variableUrl']]));
}catch(Throwable $error){$fixture->cleanup();if($theme_link&&is_link($theme_link))unlink($theme_link);if($probe_link&&is_link($probe_link))unlink($probe_link);throw $error;}
