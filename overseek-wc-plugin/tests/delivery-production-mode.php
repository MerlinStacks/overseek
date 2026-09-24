<?php
/** Production-only timing reuses stored ranges without inbound or receipt prerequisites. */
declare(strict_types=1);
require __DIR__ . '/delivery-live-adapter.php';
function wc_get_held_stock_quantity( $owner, $exclude = 0 ) { return $GLOBALS['production_held'] ?? 0; }

[ $store, $product, $rates ] = fixture();
$saved = $store->settings;
$store->settings['settings']['estimateMode'] = 'production';
$store->inbound = [];
$product->managed = true;
$product->stock = 5;
same( 'available', run_adapter( $store, [ line( $product, 2 ) ], $rates )['status'], 'managed stock needs no inbound or receipt proof' );
same( false, isset( $store->reads['inbound:10'] ), 'does not read incoming stock' );
$GLOBALS['production_held'] = 4;
unavailable( 'production_stock_unavailable', run_adapter( $store, [ line( $product, 2 ) ], $rates ), 'reserved stock is not available' );
$GLOBALS['production_held'] = 0;
$product->backorders = true;
unavailable( 'production_stock_unavailable', run_adapter( $store, [ line( $product, 3 ), line( clone $product, 3 ) ], $rates ), 'aggregate demand cannot use backorders' );
$product->status = 'onbackorder';
unavailable( 'production_stock_unavailable', run_adapter( $store, [ line( $product ) ], $rates ), 'no supplier arrival promise in simple mode' );
$product->status = 'instock';
$store->settings = $saved;
unavailable( 'inbound_missing', run_adapter( $store, [ line( $product ) ], $rates ), 'existing mode retains inbound prerequisite' );

[ $store, $parent, $rates ] = fixture();
$store->settings['settings']['estimateMode'] = 'production';
$store->inbound = [];
$parent->type = 'variable'; $parent->managed = true; $parent->stock = 3;
$GLOBALS['catalogue'][10] = $parent;
$a = new WC_Product_Variation( 11, 10 ); $a->owner = 10; $a->managed = 'parent';
$b = new WC_Product_Variation( 12, 10 ); $b->owner = 10; $b->managed = 'parent';
$store->products[10]['variations'] = [ [ 'wooId' => 11, 'productionMinDays' => 0, 'productionMaxDays' => 0 ] ];
$saved_product = $store->products[10];
$override = run_adapter( $store, [ line( $a ) ], $rates );
$inherited = run_adapter( $store, [ line( $b ) ], $rates );
same( 'available', $override['status'], 'explicit zero variant range is usable' );
same( 'available', $inherited['status'], 'unspecified variant inherits parent timing' );
same( false, $override === $inherited, 'zero override does not become parent timing' );
unavailable( 'production_stock_unavailable', run_adapter( $store, [ line( $a, 2 ), line( $b, 2 ) ], $rates ), 'sibling variants share their parent stock pool' );
same( $saved_product, $store->products[10], 'all saved variant ranges retained' );
fwrite( STDOUT, "Production-only delivery timing assertions passed.\n" );
