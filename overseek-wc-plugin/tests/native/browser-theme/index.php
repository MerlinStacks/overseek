<?php
/** Minimal public product template retaining native Woo variation/quantity controls. */
if (have_posts()) the_post();
global $product;
$product = get_post_type()==='product' ? wc_get_product(get_the_ID()) : null;
// Buffer standard content filtering before wp_head so lazy shortcode/block CSS is printed.
$content = $product ? apply_filters('the_content',get_the_content()) : '';
?><!doctype html>
<html <?php language_attributes(); ?>><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><?php wp_head(); ?></head>
<body <?php body_class(); ?>><?php wp_body_open(); ?><main>
<div class="fixture-label">Native Woo/WBS integration fixture</div>
<?php if ($product): ?><article class="product" data-native-product="<?php echo esc_attr($product->get_id()); ?>">
<h1><?php echo esc_html($product->get_name()); ?></h1>
<?php woocommerce_template_single_add_to_cart(); ?>
<?php echo $content; // Content is processed through WordPress's normal block/shortcode filters. ?>
</article><?php else: ?><h1>Disposable browser fixture</h1><?php endif; ?>
</main><?php wp_footer(); ?></body></html>
