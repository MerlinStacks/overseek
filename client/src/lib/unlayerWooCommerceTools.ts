/**
 * WooCommerce Custom Tools for Unlayer Email Editor
 * 
 * Registers dynamic WooCommerce blocks that render order/customer data
 * via merge tags replaced server-side at send time.
 */

// Types for Unlayer editor reference
interface UnlayerEditor {
    registerTool: (config: any) => void;
    createViewer: (config: { render: (values: any) => string }) => any;
}

/**
 * Merge tag definitions for WooCommerce data
 * These are replaced server-side with actual order/customer data
 */
export const WOO_MERGE_TAGS = {
    // Order
    'order.number': '{{order.number}}',
    'order.date': '{{order.date}}',
    'order.status': '{{order.status}}',
    'order.paymentMethod': '{{order.paymentMethod}}',
    'order.subtotal': '{{order.subtotal}}',
    'order.shippingTotal': '{{order.shippingTotal}}',
    'order.discountTotal': '{{order.discountTotal}}',
    'order.total': '{{order.total}}',
    'order.itemsTable': '{{order.itemsTable}}',
    'order.billingAddress': '{{order.billingAddress}}',
    'order.shippingAddress': '{{order.shippingAddress}}',
    'order.customerNote': '{{order.customerNote}}',
    'order.downloads': '{{order.downloads}}',
    // Customer
    'customer.firstName': '{{customer.firstName}}',
    'customer.lastName': '{{customer.lastName}}',
    'customer.email': '{{customer.email}}',
    'customer.phone': '{{customer.phone}}',
    // Coupon
    'coupon.code': '{{coupon.code}}',
    'coupon.discount': '{{coupon.discount}}',
    'coupon.description': '{{coupon.description}}',
};

/**
 * Get merge tags configuration for Unlayer editor
 * Enables merge tag autocomplete in the editor
 */
export function getWooCommerceMergeTags() {
    return {
        order: {
            name: 'Order',
            mergeTags: {
                number: { name: 'Order Number', value: '{{order.number}}' },
                date: { name: 'Order Date', value: '{{order.date}}' },
                status: { name: 'Order Status', value: '{{order.status}}' },
                paymentMethod: { name: 'Payment Method', value: '{{order.paymentMethod}}' },
                subtotal: { name: 'Subtotal', value: '{{order.subtotal}}' },
                shippingTotal: { name: 'Shipping Total', value: '{{order.shippingTotal}}' },
                discountTotal: { name: 'Discount Total', value: '{{order.discountTotal}}' },
                total: { name: 'Order Total', value: '{{order.total}}' },
                customerNote: { name: 'Customer Note', value: '{{order.customerNote}}' },
            },
        },
        customer: {
            name: 'Customer',
            mergeTags: {
                firstName: { name: 'First Name', value: '{{customer.firstName}}' },
                lastName: { name: 'Last Name', value: '{{customer.lastName}}' },
                email: { name: 'Email', value: '{{customer.email}}' },
                phone: { name: 'Phone', value: '{{customer.phone}}' },
            },
        },
    };
}

/**
 * Register all WooCommerce custom tools with the Unlayer editor
 */
export function registerWooCommerceTools(unlayer: UnlayerEditor) {
    // ============================================
    // 1. PRODUCT BLOCK
    // ============================================
    unlayer.registerTool({
        name: 'woo_product',
        label: 'Product',
        icon: 'fa-cube',
        supportedDisplayModes: ['email'],
        options: {
            productSettings: {
                title: 'Product Settings',
                position: 1,
                options: {
                    showImage: {
                        label: 'Show Image',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                    showPrice: {
                        label: 'Show Price',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                    showDescription: {
                        label: 'Show Description',
                        defaultValue: false,
                        widget: 'toggle',
                    },
                    imageWidth: {
                        label: 'Image Width',
                        defaultValue: '200',
                        widget: 'counter',
                    },
                },
            },
        },
        values: {},
        renderer: {
            Viewer: unlayer.createViewer({
                render(values: any) {
                    const showImage = values.showImage !== false;
                    const showPrice = values.showPrice !== false;
                    const showDescription = values.showDescription === true;
                    const imageWidth = values.imageWidth || '200';

                    return `
            <div style="text-align: center; padding: 20px; font-family: Arial, sans-serif;">
              ${showImage ? `
                <div style="margin-bottom: 15px;">
                  <img src="https://via.placeholder.com/${imageWidth}x${imageWidth}?text=Product+Image" 
                       alt="Product" 
                       style="max-width: ${imageWidth}px; border-radius: 8px;" />
                </div>
              ` : ''}
              <h3 style="margin: 0 0 8px 0; color: #333; font-size: 18px;">{{product.name}}</h3>
              ${showDescription ? `<p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">{{product.description}}</p>` : ''}
              ${showPrice ? `<p style="margin: 0; color: #2563eb; font-weight: bold; font-size: 16px;">{{product.price}}</p>` : ''}
            </div>
          `;
                },
            }),
            exporters: {
                email(values: any) {
                    const showImage = values.showImage !== false;
                    const showPrice = values.showPrice !== false;
                    const showDescription = values.showDescription === true;
                    const imageWidth = values.imageWidth || '200';

                    return `
            <div style="text-align: center; padding: 20px; font-family: Arial, sans-serif;">
              ${showImage ? `
                <div style="margin-bottom: 15px;">
                  <img src="{{product.image}}" 
                       alt="{{product.name}}" 
                       style="max-width: ${imageWidth}px; border-radius: 8px;" />
                </div>
              ` : ''}
              <h3 style="margin: 0 0 8px 0; color: #333; font-size: 18px;">{{product.name}}</h3>
              ${showDescription ? `<p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">{{product.description}}</p>` : ''}
              ${showPrice ? `<p style="margin: 0; color: #2563eb; font-weight: bold; font-size: 16px;">{{product.price}}</p>` : ''}
            </div>
          `;
                },
            },
            head: {
                css() { return ''; },
                js() { return ''; },
            },
        },
    });

    // ============================================
    // 2. COUPON BLOCK
    // ============================================
    unlayer.registerTool({
        name: 'woo_coupon',
        label: 'Coupon',
        icon: 'fa-ticket',
        supportedDisplayModes: ['email'],
        options: {
            couponSettings: {
                title: 'Coupon Settings',
                position: 1,
                options: {
                    backgroundColor: {
                        label: 'Background Color',
                        defaultValue: '#f3f4f6',
                        widget: 'color_picker',
                    },
                    borderStyle: {
                        label: 'Border Style',
                        defaultValue: 'dashed',
                        widget: 'dropdown',
                        data: {
                            options: [
                                { value: 'solid', label: 'Solid' },
                                { value: 'dashed', label: 'Dashed' },
                                { value: 'dotted', label: 'Dotted' },
                                { value: 'none', label: 'None' },
                            ],
                        },
                    },
                    showDiscount: {
                        label: 'Show Discount Amount',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                },
            },
        },
        values: {},
        renderer: {
            Viewer: unlayer.createViewer({
                render(values: any) {
                    const bgColor = values.backgroundColor || '#f3f4f6';
                    const borderStyle = values.borderStyle || 'dashed';
                    const showDiscount = values.showDiscount !== false;

                    return `
            <div style="text-align: center; padding: 24px; font-family: Arial, sans-serif;">
              <div style="display: inline-block; background: ${bgColor}; border: 2px ${borderStyle} #9ca3af; border-radius: 12px; padding: 20px 40px;">
                <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Use Code</p>
                <p style="margin: 0; color: #111827; font-size: 24px; font-weight: bold; letter-spacing: 2px;">{{coupon.code}}</p>
                ${showDiscount ? `<p style="margin: 12px 0 0 0; color: #059669; font-size: 14px; font-weight: 600;">Save {{coupon.discount}}</p>` : ''}
              </div>
            </div>
          `;
                },
            }),
            exporters: {
                email(values: any) {
                    const bgColor = values.backgroundColor || '#f3f4f6';
                    const borderStyle = values.borderStyle || 'dashed';
                    const showDiscount = values.showDiscount !== false;

                    return `
            <div style="text-align: center; padding: 24px; font-family: Arial, sans-serif;">
              <div style="display: inline-block; background: ${bgColor}; border: 2px ${borderStyle} #9ca3af; border-radius: 12px; padding: 20px 40px;">
                <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Use Code</p>
                <p style="margin: 0; color: #111827; font-size: 24px; font-weight: bold; letter-spacing: 2px;">{{coupon.code}}</p>
                ${showDiscount ? `<p style="margin: 12px 0 0 0; color: #059669; font-size: 14px; font-weight: 600;">Save {{coupon.discount}}</p>` : ''}
              </div>
            </div>
          `;
                },
            },
            head: {
                css() { return ''; },
                js() { return ''; },
            },
        },
    });

    // ============================================
    // 3. CUSTOMER ADDRESS BLOCK
    // ============================================
    unlayer.registerTool({
        name: 'woo_address',
        label: 'Customer Address',
        icon: 'fa-map-marker-alt',
        supportedDisplayModes: ['email'],
        options: {
            addressSettings: {
                title: 'Address Settings',
                position: 1,
                options: {
                    addressType: {
                        label: 'Address Type',
                        defaultValue: 'billing',
                        widget: 'dropdown',
                        data: {
                            options: [
                                { value: 'billing', label: 'Billing Address' },
                                { value: 'shipping', label: 'Shipping Address' },
                                { value: 'both', label: 'Both Addresses' },
                            ],
                        },
                    },
                    showLabel: {
                        label: 'Show Label',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                },
            },
        },
        values: {},
        renderer: {
            Viewer: unlayer.createViewer({
                render(values: any) {
                    const addressType = values.addressType || 'billing';
                    const showLabel = values.showLabel !== false;

                    const renderAddress = (type: string, label: string, placeholder: string) => `
            <div style="flex: 1; min-width: 200px;">
              ${showLabel ? `<p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; font-weight: 600;">${label}</p>` : ''}
              <div style="background: #f9fafb; border-radius: 8px; padding: 16px; border: 1px solid #e5e7eb;">
                <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${placeholder}</p>
              </div>
            </div>
          `;

                    return `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                ${addressType === 'billing' || addressType === 'both'
                            ? renderAddress('billing', 'Billing Address', 'John Doe<br>123 Main Street<br>Sydney, NSW 2000<br>Australia')
                            : ''}
                ${addressType === 'shipping' || addressType === 'both'
                            ? renderAddress('shipping', 'Shipping Address', 'John Doe<br>456 Delivery Lane<br>Melbourne, VIC 3000<br>Australia')
                            : ''}
              </div>
            </div>
          `;
                },
            }),
            exporters: {
                email(values: any) {
                    const addressType = values.addressType || 'billing';
                    const showLabel = values.showLabel !== false;

                    const renderAddress = (type: string, label: string, mergeTag: string) => `
            <div style="flex: 1; min-width: 200px;">
              ${showLabel ? `<p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; font-weight: 600;">${label}</p>` : ''}
              <div style="background: #f9fafb; border-radius: 8px; padding: 16px; border: 1px solid #e5e7eb;">
                <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${mergeTag}</p>
              </div>
            </div>
          `;

                    // Use table layout for email compatibility
                    return `
            <table width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif;">
              <tr>
                ${addressType === 'billing' || addressType === 'both'
                            ? `<td style="padding: 10px; vertical-align: top;">
                      ${showLabel ? `<p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; font-weight: 600;">Billing Address</p>` : ''}
                      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; border: 1px solid #e5e7eb;">
                        {{order.billingAddress}}
                      </div>
                    </td>`
                            : ''}
                ${addressType === 'shipping' || addressType === 'both'
                            ? `<td style="padding: 10px; vertical-align: top;">
                      ${showLabel ? `<p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; text-transform: uppercase; font-weight: 600;">Shipping Address</p>` : ''}
                      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; border: 1px solid #e5e7eb;">
                        {{order.shippingAddress}}
                      </div>
                    </td>`
                            : ''}
              </tr>
            </table>
          `;
                },
            },
            head: {
                css() { return ''; },
                js() { return ''; },
            },
        },
    });

    // ============================================
    // 4. ORDER SUMMARY BLOCK
    // ============================================
    unlayer.registerTool({
        name: 'woo_order_summary',
        label: 'Order Summary',
        icon: 'fa-file-invoice',
        supportedDisplayModes: ['email'],
        options: {
            summarySettings: {
                title: 'Summary Settings',
                position: 1,
                options: {
                    showImages: {
                        label: 'Show Product Images',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                    showShipping: {
                        label: 'Show Shipping',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                    showDiscount: {
                        label: 'Show Discount',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                    headerColor: {
                        label: 'Header Color',
                        defaultValue: '#f3f4f6',
                        widget: 'color_picker',
                    },
                },
            },
        },
        values: {},
        renderer: {
            Viewer: unlayer.createViewer({
                render(values: any) {
                    const showImages = values.showImages !== false;
                    const showShipping = values.showShipping !== false;
                    const showDiscount = values.showDiscount !== false;
                    const headerColor = values.headerColor || '#f3f4f6';

                    return `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                <thead>
                  <tr style="background: ${headerColor};">
                    ${showImages ? '<th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;"></th>' : ''}
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Product</th>
                    <th style="padding: 12px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase;">Qty</th>
                    <th style="padding: 12px; text-align: right; font-size: 12px; color: #6b7280; text-transform: uppercase;">Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    ${showImages ? '<td style="padding: 12px;"><div style="width: 50px; height: 50px; background: #e5e7eb; border-radius: 4px;"></div></td>' : ''}
                    <td style="padding: 12px; color: #374151;">Sample Product Name</td>
                    <td style="padding: 12px; text-align: center; color: #374151;">1</td>
                    <td style="padding: 12px; text-align: right; color: #374151;">$99.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    ${showImages ? '<td style="padding: 12px;"><div style="width: 50px; height: 50px; background: #e5e7eb; border-radius: 4px;"></div></td>' : ''}
                    <td style="padding: 12px; color: #374151;">Another Product</td>
                    <td style="padding: 12px; text-align: center; color: #374151;">2</td>
                    <td style="padding: 12px; text-align: right; color: #374151;">$49.00</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="${showImages ? 3 : 2}" style="padding: 12px; text-align: right; color: #6b7280;">Subtotal</td>
                    <td style="padding: 12px; text-align: right; color: #374151; font-weight: 500;">$197.00</td>
                  </tr>
                  ${showShipping ? `
                    <tr>
                      <td colspan="${showImages ? 3 : 2}" style="padding: 12px; text-align: right; color: #6b7280;">Shipping</td>
                      <td style="padding: 12px; text-align: right; color: #374151;">$10.00</td>
                    </tr>
                  ` : ''}
                  ${showDiscount ? `
                    <tr>
                      <td colspan="${showImages ? 3 : 2}" style="padding: 12px; text-align: right; color: #059669;">Discount</td>
                      <td style="padding: 12px; text-align: right; color: #059669;">-$20.00</td>
                    </tr>
                  ` : ''}
                  <tr style="border-top: 2px solid #111827;">
                    <td colspan="${showImages ? 3 : 2}" style="padding: 12px; text-align: right; color: #111827; font-weight: 700; font-size: 16px;">Total</td>
                    <td style="padding: 12px; text-align: right; color: #111827; font-weight: 700; font-size: 16px;">$187.00</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          `;
                },
            }),
            exporters: {
                email(values: any) {
                    const showShipping = values.showShipping !== false;
                    const showDiscount = values.showDiscount !== false;
                    const headerColor = values.headerColor || '#f3f4f6';

                    // The items table merge tag renders the full table with items
                    return `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              {{order.itemsTable}}
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-top: 10px;">
                <tr>
                  <td style="padding: 12px; text-align: right; color: #6b7280;">Subtotal</td>
                  <td style="padding: 12px; text-align: right; color: #374151; font-weight: 500; width: 100px;">{{order.subtotal}}</td>
                </tr>
                ${showShipping ? `
                  <tr>
                    <td style="padding: 12px; text-align: right; color: #6b7280;">Shipping</td>
                    <td style="padding: 12px; text-align: right; color: #374151; width: 100px;">{{order.shippingTotal}}</td>
                  </tr>
                ` : ''}
                ${showDiscount ? `
                  <tr>
                    <td style="padding: 12px; text-align: right; color: #059669;">Discount</td>
                    <td style="padding: 12px; text-align: right; color: #059669; width: 100px;">-{{order.discountTotal}}</td>
                  </tr>
                ` : ''}
                <tr style="border-top: 2px solid #111827;">
                  <td style="padding: 12px; text-align: right; color: #111827; font-weight: 700; font-size: 16px;">Total</td>
                  <td style="padding: 12px; text-align: right; color: #111827; font-weight: 700; font-size: 16px; width: 100px;">{{order.total}}</td>
                </tr>
              </table>
            </div>
          `;
                },
            },
            head: {
                css() { return ''; },
                js() { return ''; },
            },
        },
    });

    // ============================================
    // 5. CUSTOMER NOTES BLOCK
    // ============================================
    unlayer.registerTool({
        name: 'woo_customer_notes',
        label: 'Customer Notes',
        icon: 'fa-sticky-note',
        supportedDisplayModes: ['email'],
        options: {
            notesSettings: {
                title: 'Notes Settings',
                position: 1,
                options: {
                    showIcon: {
                        label: 'Show Icon',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                    backgroundColor: {
                        label: 'Background Color',
                        defaultValue: '#fef3c7',
                        widget: 'color_picker',
                    },
                    borderColor: {
                        label: 'Border Color',
                        defaultValue: '#f59e0b',
                        widget: 'color_picker',
                    },
                },
            },
        },
        values: {},
        renderer: {
            Viewer: unlayer.createViewer({
                render(values: any) {
                    const showIcon = values.showIcon !== false;
                    const bgColor = values.backgroundColor || '#fef3c7';
                    const borderColor = values.borderColor || '#f59e0b';

                    return `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              <div style="background: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 0 8px 8px 0; padding: 16px;">
                <div style="display: flex; align-items: flex-start; gap: 12px;">
                  ${showIcon ? `<span style="font-size: 20px;">📝</span>` : ''}
                  <div>
                    <p style="margin: 0 0 4px 0; color: #92400e; font-size: 12px; font-weight: 600; text-transform: uppercase;">Customer Note</p>
                    <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.5;">Please leave the package at the front door. Thank you!</p>
                  </div>
                </div>
              </div>
            </div>
          `;
                },
            }),
            exporters: {
                email(values: any) {
                    const showIcon = values.showIcon !== false;
                    const bgColor = values.backgroundColor || '#fef3c7';
                    const borderColor = values.borderColor || '#f59e0b';

                    return `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              <div style="background: ${bgColor}; border-left: 4px solid ${borderColor}; border-radius: 0 8px 8px 0; padding: 16px;">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${showIcon ? `<td style="vertical-align: top; padding-right: 12px; font-size: 20px;">📝</td>` : ''}
                    <td style="vertical-align: top;">
                      <p style="margin: 0 0 4px 0; color: #92400e; font-size: 12px; font-weight: 600; text-transform: uppercase;">Customer Note</p>
                      <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.5;">{{order.customerNote}}</p>
                    </td>
                  </tr>
                </table>
              </div>
            </div>
          `;
                },
            },
            head: {
                css() { return ''; },
                js() { return ''; },
            },
        },
    });

    // ============================================
    // 6. ORDER DOWNLOADS BLOCK
    // ============================================
    unlayer.registerTool({
        name: 'woo_order_downloads',
        label: 'Order Downloads',
        icon: 'fa-download',
        supportedDisplayModes: ['email'],
        options: {
            downloadSettings: {
                title: 'Download Settings',
                position: 1,
                options: {
                    buttonStyle: {
                        label: 'Button Style',
                        defaultValue: 'primary',
                        widget: 'dropdown',
                        data: {
                            options: [
                                { value: 'primary', label: 'Primary (Blue)' },
                                { value: 'secondary', label: 'Secondary (Gray)' },
                                { value: 'success', label: 'Success (Green)' },
                            ],
                        },
                    },
                    showExpiry: {
                        label: 'Show Expiry Date',
                        defaultValue: true,
                        widget: 'toggle',
                    },
                },
            },
        },
        values: {},
        renderer: {
            Viewer: unlayer.createViewer({
                render(values: any) {
                    const buttonStyle = values.buttonStyle || 'primary';
                    const showExpiry = values.showExpiry !== false;

                    const buttonColors: Record<string, { bg: string; text: string }> = {
                        primary: { bg: '#2563eb', text: '#ffffff' },
                        secondary: { bg: '#6b7280', text: '#ffffff' },
                        success: { bg: '#059669', text: '#ffffff' },
                    };

                    const colors = buttonColors[buttonStyle] || buttonColors.primary;

                    return `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px; font-weight: 600;">Your Downloads</p>
              <div style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <div style="padding: 16px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <p style="margin: 0 0 4px 0; color: #111827; font-size: 14px; font-weight: 500;">Digital Product Guide.pdf</p>
                    ${showExpiry ? `<p style="margin: 0; color: #6b7280; font-size: 12px;">Expires: Jan 31, 2026</p>` : ''}
                  </div>
                  <a href="#" style="display: inline-block; background: ${colors.bg}; color: ${colors.text}; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500;">Download</a>
                </div>
                <div style="padding: 16px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <p style="margin: 0 0 4px 0; color: #111827; font-size: 14px; font-weight: 500;">Bonus Content.zip</p>
                    ${showExpiry ? `<p style="margin: 0; color: #6b7280; font-size: 12px;">Expires: Feb 15, 2026</p>` : ''}
                  </div>
                  <a href="#" style="display: inline-block; background: ${colors.bg}; color: ${colors.text}; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500;">Download</a>
                </div>
              </div>
            </div>
          `;
                },
            }),
            exporters: {
                email(values: any) {
                    // The downloads merge tag renders the full download list
                    return `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 14px; font-weight: 600;">Your Downloads</p>
              {{order.downloads}}
            </div>
          `;
                },
            },
            head: {
                css() { return ''; },
                js() { return ''; },
            },
        },
    });

    console.log('[Unlayer] WooCommerce custom tools registered successfully');
}
