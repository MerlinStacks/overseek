(function (wp) {
    'use strict';
    wp.blocks.registerBlockType('overseek/delivery-estimate', {
        edit: function () {
            return wp.element.createElement('div', wp.blockEditor.useBlockProps(),
                wp.element.createElement('strong', null, wp.i18n.__('Delivery estimate', 'overseek-wc')),
                wp.element.createElement('p', null, wp.i18n.__(
                    'Placement preview only. Customer dates appear for configured products when delivery estimates are active. Manage production and shipping settings in Overseek.', 'overseek-wc')));
        },
        save: function () { return null; }
    });
}(window.wp));
