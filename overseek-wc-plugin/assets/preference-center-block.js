( function( blocks, blockEditor, components, element ) {
	const el = element.createElement;
	const InspectorControls = blockEditor.InspectorControls;
	const PanelBody = components.PanelBody;
	const TextControl = components.TextControl;
	const Placeholder = components.Placeholder;

	blocks.registerBlockType( 'overseek/preference-center', {
		edit: function( props ) {
			const attributes = props.attributes || {};
			const title = attributes.title || 'Email Preferences';

			return el(
				element.Fragment,
				null,
				el(
					InspectorControls,
					null,
					el(
						PanelBody,
						{ title: 'Preference Center Settings', initialOpen: true },
						el( TextControl, {
							label: 'Title',
							value: title,
							onChange: function( value ) {
								props.setAttributes( { title: value } );
							}
						} )
					)
				),
				el(
					Placeholder,
					{
						label: 'OverSeek Preference Center',
						instructions: 'This block renders the customer email preference center on the storefront. Customers must arrive with an email preference token in the page URL.'
					},
					el( 'p', null, 'Shortcode equivalent: [overseek_preference_center]' ),
					el( 'p', null, 'Current title: ' + title )
				)
			);
		},
		save: function() {
			return null;
		}
	} );
} )(
	window.wp.blocks,
	window.wp.blockEditor || window.wp.editor,
	window.wp.components,
	window.wp.element
);
