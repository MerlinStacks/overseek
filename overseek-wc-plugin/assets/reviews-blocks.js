( function( blocks, blockEditor, components, element, serverSideRender ) {
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
	const ColorPalette = components.ColorPalette;
	const ServerSideRender = serverSideRender;

	function boolAttr( value ) {
		return value === true || value === '1';
	}

	function setBoolAttr( props, key, value ) {
		props.setAttributes( Object.assign( {}, props.attributes, { [ key ]: value ? '1' : '0' } ) );
	}

	function commonControls( props, options ) {
		const attributes = props.attributes || {};
		const colors = [
			{ name: 'Amber', color: '#f59e0b' },
			{ name: 'Blue', color: '#2563eb' },
			{ name: 'Green', color: '#10b981' },
			{ name: 'Slate', color: '#0f172a' },
			{ name: 'Rose', color: '#fb7185' }
		];
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
				options.sort !== false && el( SelectControl, {
					label: 'Sort reviews',
					value: attributes.sort_by || 'date',
					options: [
						{ label: 'Newest first', value: 'date_desc' },
						{ label: 'Oldest first', value: 'date_asc' },
						{ label: 'Highest rated', value: 'rating_desc' },
						{ label: 'Lowest rated', value: 'rating_asc' },
						{ label: 'With media first', value: 'media' },
						{ label: 'Random', value: 'random' }
					],
					onChange: function( value ) {
						props.setAttributes( { sort_by: value } );
					}
				} ),
				options.minRating !== false && el( RangeControl, {
					label: 'Exclude reviews under',
					help: 'Only reviews with this star rating or higher are included. Set to 0 to show all reviews.',
					value: attributes.min_rating || 0,
					min: 0,
					max: 5,
					onChange: function( value ) {
						props.setAttributes( { min_rating: value || 0 } );
					}
				} ),
				options.media && el( ToggleControl, {
					label: 'Show review media',
					checked: boolAttr( attributes.show_media ),
					onChange: function( value ) {
						setBoolAttr( props, 'show_media', value );
					}
				} ),
				options.media && el( ToggleControl, {
					label: 'Only reviews with media',
					checked: boolAttr( attributes.only_media ),
					onChange: function( value ) {
						setBoolAttr( props, 'only_media', value );
					}
				} ),
				options.parts !== false && el( ToggleControl, {
					label: 'Only verified owners',
					checked: boolAttr( attributes.verified_only ),
					onChange: function( value ) {
						setBoolAttr( props, 'verified_only', value );
					}
				} ),
				options.showProduct && el( ToggleControl, {
					label: 'Show product names',
					checked: boolAttr( attributes.show_product ),
					onChange: function( value ) {
						setBoolAttr( props, 'show_product', value );
					}
				} ),
				options.showProduct && el( ToggleControl, {
					label: 'Show product thumbnail',
					checked: boolAttr( attributes.show_product_image !== undefined ? attributes.show_product_image : '1' ),
					onChange: function( value ) {
						setBoolAttr( props, 'show_product_image', value );
					}
				} ),
				options.parts !== false && el( ToggleControl, { label: 'Show reviewer name', checked: boolAttr( attributes.show_reviewer !== undefined ? attributes.show_reviewer : '1' ), onChange: function( value ) { setBoolAttr( props, 'show_reviewer', value ); } } ),
				options.parts !== false && el( ToggleControl, { label: 'Show verified badge', checked: boolAttr( attributes.show_verified !== undefined ? attributes.show_verified : '1' ), onChange: function( value ) { setBoolAttr( props, 'show_verified', value ); } } ),
				options.parts !== false && el( ToggleControl, { label: 'Show country flag', checked: boolAttr( attributes.show_country !== undefined ? attributes.show_country : '1' ), onChange: function( value ) { setBoolAttr( props, 'show_country', value ); } } ),
				options.parts !== false && el( ToggleControl, { label: 'Show review date', checked: boolAttr( attributes.show_date !== undefined ? attributes.show_date : '1' ), onChange: function( value ) { setBoolAttr( props, 'show_date', value ); } } ),
				options.parts !== false && el( ToggleControl, { label: 'Show merchant replies', checked: boolAttr( attributes.show_replies !== undefined ? attributes.show_replies : '1' ), onChange: function( value ) { setBoolAttr( props, 'show_replies', value ); } } ),
				options.summary && el( ToggleControl, { label: 'Show summary bar', checked: boolAttr( attributes.show_summary_bar !== undefined ? attributes.show_summary_bar : '1' ), onChange: function( value ) { setBoolAttr( props, 'show_summary_bar', value ); } } ),
				options.parts !== false && el( RangeControl, { label: 'Maximum review characters', value: attributes.max_chars || 0, min: 0, max: 600, step: 25, help: 'Set to 0 to show the full review.', onChange: function( value ) { props.setAttributes( { max_chars: value || 0 } ); } } ),
				options.parts !== false && el( SelectControl, { label: 'Card style', value: attributes.card_style || 'comfortable', options: [ { label: 'Compact', value: 'compact' }, { label: 'Comfortable', value: 'comfortable' }, { label: 'Feature card', value: 'feature' } ], onChange: function( value ) { props.setAttributes( { card_style: value } ); } } ),
				options.parts !== false && el( RangeControl, { label: 'Border radius', value: attributes.radius || 28, min: 8, max: 40, onChange: function( value ) { props.setAttributes( { radius: value || 28 } ); } } ),
				options.parts !== false && el( RangeControl, { label: 'Shadow strength', value: attributes.shadow || 2, min: 0, max: 3, onChange: function( value ) { props.setAttributes( { shadow: value || 0 } ); } } ),
				options.filters && el( TextControl, { label: 'Product IDs', help: 'Comma-separated product IDs.', value: attributes.products || '', onChange: function( value ) { props.setAttributes( { products: value } ); } } ),
				options.filters && el( TextControl, { label: 'Category IDs', help: 'Comma-separated product category IDs.', value: attributes.categories || '', onChange: function( value ) { props.setAttributes( { categories: value } ); } } ),
				options.filters && el( TextControl, { label: 'Product tag slugs', help: 'Comma-separated product tag slugs.', value: attributes.product_tags || '', onChange: function( value ) { props.setAttributes( { product_tags: value } ); } } ),
				options.source && el( SelectControl, { label: 'Review source', value: attributes.review_source || 'product', options: [ { label: 'Product reviews only', value: 'product' }, { label: 'Shop reviews only', value: 'shop' }, { label: 'Product and shop reviews', value: 'both' } ], onChange: function( value ) { props.setAttributes( { review_source: value } ); } } ),
				options.slider && el( RangeControl, { label: 'Cards visible on desktop', value: attributes.slider_desktop || 3, min: 1, max: 5, onChange: function( value ) { props.setAttributes( { slider_desktop: value || 3 } ); } } ),
				options.slider && el( RangeControl, { label: 'Cards visible on mobile', value: attributes.slider_mobile || 1, min: 1, max: 2, onChange: function( value ) { props.setAttributes( { slider_mobile: value || 1 } ); } } ),
				options.slider && el( ToggleControl, { label: 'Auto-scroll slider', checked: boolAttr( attributes.slider_autoplay ), onChange: function( value ) { setBoolAttr( props, 'slider_autoplay', value ); } } ),
				options.slider && el( ToggleControl, { label: 'Show slider arrows', checked: boolAttr( attributes.slider_arrows !== undefined ? attributes.slider_arrows : '1' ), onChange: function( value ) { setBoolAttr( props, 'slider_arrows', value ); } } ),
				options.slider && el( ToggleControl, { label: 'Show slider dots', checked: boolAttr( attributes.slider_dots ), onChange: function( value ) { setBoolAttr( props, 'slider_dots', value ); } } ),
				options.colors && ColorPalette && el( 'div', { className: 'overseek-review-color-control' }, el( 'p', null, 'Star colour' ), el( ColorPalette, { colors: colors, value: attributes.color_stars || '', onChange: function( value ) { props.setAttributes( { color_stars: value || '' } ); } } ) ),
				options.colors && ColorPalette && el( 'div', { className: 'overseek-review-color-control' }, el( 'p', null, 'Accent line colour' ), el( ColorPalette, { colors: colors, value: attributes.color_brdr || '', onChange: function( value ) { props.setAttributes( { color_brdr: value || '' } ); } } ) ),
				options.colors && ColorPalette && el( 'div', { className: 'overseek-review-color-control' }, el( 'p', null, 'Card background' ), el( ColorPalette, { colors: colors, value: attributes.color_bcrd || '', onChange: function( value ) { props.setAttributes( { color_bcrd: value || '' } ); } } ) ),
				options.colors && ColorPalette && el( 'div', { className: 'overseek-review-color-control' }, el( 'p', null, 'Product strip background' ), el( ColorPalette, { colors: colors, value: attributes.color_pr_bcrd || '', onChange: function( value ) { props.setAttributes( { color_pr_bcrd: value || '' } ); } } ) ),
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

	function preview( name, title, shortcode, attributes ) {
		if ( ! ServerSideRender ) {
			return el( 'div', { className: 'os-reviews-empty' }, 'Preview unavailable. Shortcode equivalent: ' + shortcode );
		}

		return el(
			'div',
			{ className: 'os-review-block-preview', 'aria-label': title },
			el( ServerSideRender, {
				block: name,
				attributes: attributes || {},
				httpMethod: 'POST'
			} )
		);
	}

	function registerReviewBlock( name, title, shortcode, options ) {
		blocks.registerBlockType( name, {
			edit: function( props ) {
				return el(
					element.Fragment,
					null,
					commonControls( props, options || {} ),
					preview( name, title, shortcode, props.attributes )
				);
			},
			save: function() {
				return null;
			}
		} );
	}

	registerReviewBlock( 'overseek/reviews', 'OverSeek Reviews', '[overseek_reviews]', { product: true, limit: true, layout: true, pagination: true, media: true, showProduct: true, summary: true, filters: true, source: true, colors: true } );
	registerReviewBlock( 'overseek/review-slider', 'OverSeek Review Slider', '[overseek_review_slider]', { product: true, limit: true, media: true, showProduct: true, slider: true, filters: true, source: true, colors: true } );
	registerReviewBlock( 'overseek/review-rows', 'OverSeek Review Rows', '[overseek_review_rows]', { product: true, limit: true, showProduct: true, filters: true, source: true } );
	registerReviewBlock( 'overseek/product-reviews', 'OverSeek Product Reviews', '[overseek_product_reviews]', { product: true, limit: true, layout: true, media: true, colors: true } );
	registerReviewBlock( 'overseek/review-summary', 'OverSeek Review Summary', '[overseek_review_summary]', { product: true, limit: false, source: true } );
	registerReviewBlock( 'overseek/review-form', 'OverSeek Review Form', '[overseek_review_form]', { product: true, limit: false, minRating: false, title: true } );
} )(
	window.wp.blocks,
	window.wp.blockEditor || window.wp.editor,
	window.wp.components,
	window.wp.element,
	window.wp.serverSideRender
);
