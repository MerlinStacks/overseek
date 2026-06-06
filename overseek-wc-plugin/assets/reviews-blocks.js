( function( blocks, blockEditor, components, element ) {
	if ( window.overseekReviewBlocksRegistered ) {
		return;
	}
	const el = element.createElement;
	if ( ! blockEditor || ! blockEditor.InspectorControls ) {
		return;
	}
	window.overseekReviewBlocksRegistered = true;
	const InspectorControls = blockEditor.InspectorControls;
	const PanelBody = components.PanelBody;
	const TextControl = components.TextControl;
	const RangeControl = components.RangeControl;
	const SelectControl = components.SelectControl;
	const ToggleControl = components.ToggleControl;
	const Placeholder = components.Placeholder;

	function boolAttr( value ) {
		return value === true || value === '1';
	}

	function setBoolAttr( props, key, value ) {
		props.setAttributes( Object.assign( {}, props.attributes, { [ key ]: value ? '1' : '0' } ) );
	}

	function commonControls( props, options ) {
		const attributes = props.attributes || {};
		return el(
			InspectorControls,
			null,
			el(
				PanelBody,
				{ title: 'Review Settings', initialOpen: true },
				options.product !== false && el( TextControl, {
					label: 'Product ID',
					help: 'Leave as 0 to use the current product where available.',
					value: String( attributes.product_id || 0 ),
					onChange: function( value ) {
						props.setAttributes( { product_id: parseInt( value || '0', 10 ) || 0 } );
					}
				} ),
				options.limit !== false && el( RangeControl, {
					label: 'Review limit',
					value: attributes.limit || 12,
					min: 1,
					max: 100,
					onChange: function( value ) {
						props.setAttributes( { limit: value || 12 } );
					}
				} ),
				options.layout && el( SelectControl, {
					label: 'Layout',
					value: attributes.layout || 'grid',
					options: [
						{ label: 'Grid', value: 'grid' },
						{ label: 'List', value: 'list' }
					],
					onChange: function( value ) {
						props.setAttributes( { layout: value } );
					}
				} ),
				options.layout && el( RangeControl, {
					label: 'Columns',
					value: attributes.columns || 3,
					min: 1,
					max: 4,
					onChange: function( value ) {
						props.setAttributes( { columns: value || 3 } );
					}
				} ),
				options.pagination && el( SelectControl, {
					label: 'Pagination',
					value: attributes.pagination || 'none',
					options: [
						{ label: 'None', value: 'none' },
						{ label: 'Page numbers', value: 'pages' },
						{ label: 'Load more link', value: 'load_more' },
						{ label: 'Infinite scroll-ready link', value: 'infinite' }
					],
					onChange: function( value ) {
						props.setAttributes( { pagination: value } );
					}
				} ),
				options.media && el( ToggleControl, {
					label: 'Show review media',
					checked: boolAttr( attributes.show_media ),
					onChange: function( value ) {
						setBoolAttr( props, 'show_media', value );
					}
				} ),
				options.showProduct && el( ToggleControl, {
					label: 'Show product names',
					checked: boolAttr( attributes.show_product ),
					onChange: function( value ) {
						setBoolAttr( props, 'show_product', value );
					}
				} ),
				options.title && el( TextControl, {
					label: 'Title',
					value: attributes.title || 'Write a review',
					onChange: function( value ) {
						props.setAttributes( { title: value } );
					}
				} )
			)
		);
	}

	function placeholder( title, shortcode ) {
		return el(
			Placeholder,
			{ label: title, instructions: 'This dynamic block renders native WooCommerce reviews on the storefront.' },
			el( 'p', null, 'Shortcode equivalent: ' + shortcode )
		);
	}

	function registerReviewBlock( name, title, shortcode, options ) {
		blocks.registerBlockType( name, {
			edit: function( props ) {
				return el(
					element.Fragment,
					null,
					commonControls( props, options || {} ),
					placeholder( title, shortcode )
				);
			},
			save: function() {
				return null;
			}
		} );
	}

	registerReviewBlock( 'overseek/reviews', 'OverSeek Reviews', '[overseek_reviews]', { product: true, limit: true, layout: true, pagination: true, media: true, showProduct: true } );
	registerReviewBlock( 'overseek/review-rows', 'OverSeek Review Rows', '[overseek_review_rows]', { product: true, limit: true, showProduct: true } );
	registerReviewBlock( 'overseek/product-reviews', 'OverSeek Product Reviews', '[overseek_product_reviews]', { product: true, limit: true, layout: true, media: true } );
	registerReviewBlock( 'overseek/review-summary', 'OverSeek Review Summary', '[overseek_review_summary]', { product: true, limit: false } );
	registerReviewBlock( 'overseek/review-form', 'OverSeek Review Form', '[overseek_review_form]', { product: true, limit: false, title: true } );
} )(
	window.wp.blocks,
	window.wp.blockEditor || window.wp.editor,
	window.wp.components,
	window.wp.element
);
