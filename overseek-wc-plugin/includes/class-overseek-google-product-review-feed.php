<?php
/**
 * Google Product Review XML feed.
 *
 * @package OverSeek
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Generates a Google Product Ratings compatible XML feed from WooCommerce reviews.
 */
class OverSeek_Google_Product_Review_Feed
{
	private const QUERY_VAR = 'overseek_google_product_reviews';
	private const CACHE_KEY = 'overseek_google_product_review_feed_xml_v2';
	private const CACHE_TTL = 6 * HOUR_IN_SECONDS;
	private const MAX_REVIEWS = 5000;

	/**
	 * Register feed hooks.
	 */
	public function __construct()
	{
		add_filter('query_vars', [$this, 'register_query_var']);
		add_action('init', [$this, 'register_rewrite_rule']);
		add_action('template_redirect', [$this, 'maybe_render_feed']);
	}

	/**
	 * Add query var used by the XML feed endpoint.
	 *
	 * @param array<int, string> $vars Public query vars.
	 * @return array<int, string>
	 */
	public function register_query_var(array $vars): array
	{
		$vars[] = self::QUERY_VAR;
		return $vars;
	}

	/**
	 * Register a friendly XML URL for the feed.
	 *
	 * @return void
	 */
	public function register_rewrite_rule(): void
	{
		add_rewrite_rule('^overseek-google-product-reviews\.xml$', 'index.php?' . self::QUERY_VAR . '=1', 'top');
	}

	/**
	 * Render the XML feed when requested.
	 *
	 * @return void
	 */
	public function maybe_render_feed(): void
	{
		if ('1' !== (string) get_query_var(self::QUERY_VAR)) {
			return;
		}

		if (!get_option('overseek_enable_google_product_review_feed', '')) {
			status_header(404);
			nocache_headers();
			exit;
		}

		header('Content-Type: application/xml; charset=' . get_option('blog_charset'));
		nocache_headers();
		echo $this->get_feed_xml(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		exit;
	}

	private function get_feed_xml(): string
	{
		$cached = get_transient(self::CACHE_KEY);
		if (is_string($cached) && '' !== $cached) {
			return $cached;
		}

		$xml = $this->build_feed_xml();
		set_transient(self::CACHE_KEY, $xml, self::CACHE_TTL);

		return $xml;
	}

	/**
	 * Get the public feed URL.
	 *
	 * @return string
	 */
	public static function get_feed_url(): string
	{
		return add_query_arg(self::QUERY_VAR, '1', home_url('/'));
	}

	/**
	 * Build Google Product Ratings XML.
	 *
	 * @return string
	 */
	private function build_feed_xml(): string
	{
		if (!class_exists('DOMDocument')) {
			return '<?xml version="1.0" encoding="UTF-8"?><feed><version>2.3</version><reviews></reviews></feed>';
		}

		$dom = new DOMDocument('1.0', 'UTF-8');
		$dom->formatOutput = true;

		$feed = $dom->createElement('feed');
		$feed->setAttribute('xmlns:vc', 'http://www.w3.org/2007/XMLSchema-versioning');
		$feed->setAttribute('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
		$feed->setAttribute('xsi:noNamespaceSchemaLocation', 'http://www.google.com/shopping/reviews/schema/product/2.3/product_reviews.xsd');
		$dom->appendChild($feed);

		$this->append_text_node($dom, $feed, 'version', '2.3');

		$publisher = $dom->createElement('publisher');
		$this->append_text_node($dom, $publisher, 'name', html_entity_decode(get_bloginfo('name'), ENT_QUOTES, 'UTF-8'));
		$feed->appendChild($publisher);

		$reviews = $dom->createElement('reviews');
		foreach ($this->get_review_comments() as $comment) {
			$review = $this->build_review_node($dom, $comment);
			if ($review instanceof DOMElement) {
				$reviews->appendChild($review);
			}
		}
		$feed->appendChild($reviews);

		return (string) $dom->saveXML();
	}

	/**
	 * Fetch approved WooCommerce product review comments.
	 *
	 * @return array<int, WP_Comment>
	 */
	private function get_review_comments(): array
	{
		$comments = get_comments([
			'post_type' => 'product',
			'post_status' => 'publish',
			'type'      => 'review',
			'status'    => 'approve',
			'orderby'   => 'comment_date_gmt',
			'order'     => 'DESC',
			'number'    => self::MAX_REVIEWS,
			'meta_query' => [
				[
					'key'     => 'rating',
					'value'   => 1,
					'compare' => '>=',
					'type'    => 'NUMERIC',
				],
			],
		]);

		return array_values(array_filter($comments, static fn($comment): bool => $comment instanceof WP_Comment));
	}

	/**
	 * Build a single review XML node.
	 *
	 * @param DOMDocument $dom XML document.
	 * @param WP_Comment  $comment Review comment.
	 * @return DOMElement|null
	 */
	private function build_review_node(DOMDocument $dom, WP_Comment $comment): ?DOMElement
	{
		$product = function_exists('wc_get_product') ? wc_get_product((int) $comment->comment_post_ID) : null;
		$rating = (int) get_comment_meta((int) $comment->comment_ID, 'rating', true);
		$content = trim(wp_strip_all_tags((string) $comment->comment_content));

		if (!$product || $rating < 1 || $rating > 5 || '' === $content) {
			return null;
		}

		$review = $dom->createElement('review');
		$this->append_text_node($dom, $review, 'review_id', (string) $comment->comment_ID);

		$reviewer = $dom->createElement('reviewer');
		$name = $dom->createElement('name');
		$name->setAttribute('is_anonymous', empty($comment->comment_author) ? 'true' : 'false');
		$name->appendChild($dom->createTextNode($comment->comment_author ?: 'Anonymous'));
		$reviewer->appendChild($name);
		$review->appendChild($reviewer);

		$this->append_text_node($dom, $review, 'review_timestamp', mysql2date('c', $comment->comment_date_gmt));
		$this->append_text_node($dom, $review, 'content', $content);

		$review_url = $dom->createElement('review_url');
		$review_url->setAttribute('type', 'singleton');
		$review_url->appendChild($dom->createTextNode(esc_url_raw(get_comment_link($comment))));
		$review->appendChild($review_url);

		$ratings = $dom->createElement('ratings');
		$overall = $dom->createElement('overall', (string) $rating);
		$overall->setAttribute('min', '1');
		$overall->setAttribute('max', '5');
		$ratings->appendChild($overall);
		$review->appendChild($ratings);

		$products = $dom->createElement('products');
		$products->appendChild($this->build_product_node($dom, $product));
		$review->appendChild($products);

		return $review;
	}

	/**
	 * Build product identity XML node for a reviewed product.
	 *
	 * @param DOMDocument $dom XML document.
	 * @param WC_Product  $product Reviewed product.
	 * @return DOMElement
	 */
	private function build_product_node(DOMDocument $dom, WC_Product $product): DOMElement
	{
		$product_node = $dom->createElement('product');
		$product_ids = $dom->createElement('product_ids');

		$gtin = $this->get_valid_gtin($product->get_id());
		if ('' !== $gtin) {
			$gtins = $dom->createElement('gtins');
			$this->append_text_node($dom, $gtins, 'gtin', $gtin);
			$product_ids->appendChild($gtins);
		}

		$mpn = $this->get_first_product_meta($product->get_id(), ['_wc_gpf_mpn', '_mpn']);
		if ('' !== $mpn) {
			$mpns = $dom->createElement('mpns');
			$this->append_text_node($dom, $mpns, 'mpn', $mpn);
			$product_ids->appendChild($mpns);
		}

		$sku = trim((string) $product->get_sku());
		if ('' === $sku) {
			$sku = (string) $product->get_id();
		}

		if ('' !== $sku) {
			$skus = $dom->createElement('skus');
			$this->append_text_node($dom, $skus, 'sku', $sku);
			$product_ids->appendChild($skus);
		}

		$brand = $this->get_product_brand($product->get_id());
		if ('' !== $brand) {
			$brands = $dom->createElement('brands');
			$this->append_text_node($dom, $brands, 'brand', $brand);
			$product_ids->appendChild($brands);
		}

		if ($product_ids->hasChildNodes()) {
			$product_node->appendChild($product_ids);
		}
		$this->append_text_node($dom, $product_node, 'product_name', $product->get_name());
		$this->append_text_node($dom, $product_node, 'product_url', $product->get_permalink());

		return $product_node;
	}

	/**
	 * Append an XML text node.
	 *
	 * @param DOMDocument $dom XML document.
	 * @param DOMElement  $parent Parent node.
	 * @param string      $name Node name.
	 * @param string      $value Node value.
	 * @return void
	 */
	private function append_text_node(DOMDocument $dom, DOMElement $parent, string $name, string $value): void
	{
		$node = $dom->createElement($name);
		$node->appendChild($dom->createTextNode($value));
		$parent->appendChild($node);
	}

	/**
	 * Return the first populated product meta value.
	 *
	 * @param int                $product_id Product ID.
	 * @param array<int, string> $keys Meta keys.
	 * @return string
	 */
	private function get_first_product_meta(int $product_id, array $keys): string
	{
		foreach ($keys as $key) {
			$value = trim((string) get_post_meta($product_id, $key, true));
			if ('' !== $value) {
				return $value;
			}
		}

		return '';
	}

	/**
	 * Return the first populated GTIN that matches Google's feed schema.
	 *
	 * @param int $product_id Product ID.
	 * @return string
	 */
	private function get_valid_gtin(int $product_id): string
	{
		$gtin = $this->get_first_product_meta($product_id, ['_global_unique_id', '_wc_gpf_gtin', '_alg_ean', '_wpm_gtin_code']);

		return preg_match('/^[\d \-xX]{7,}$/', $gtin) ? $gtin : '';
	}

	/**
	 * Resolve product brand from common WooCommerce brand taxonomies.
	 *
	 * @param int $product_id Product ID.
	 * @return string
	 */
	private function get_product_brand(int $product_id): string
	{
		foreach (['product_brand', 'pa_brand'] as $taxonomy) {
			$terms = taxonomy_exists($taxonomy) ? get_the_terms($product_id, $taxonomy) : false;
			if (is_array($terms) && !empty($terms)) {
				return (string) $terms[0]->name;
			}
		}

		return '';
	}
}
