<?php
/** Test theme; native Woo controls and scripts, no delivery hook or gate overrides. */
add_action('after_setup_theme', static function(): void { add_theme_support('woocommerce'); });
add_action('wp_enqueue_scripts', static function(): void { wp_enqueue_style('native-fixture-theme',get_stylesheet_uri(),[], '1.0.0'); });
