/**
 * Merge Tag Resolver Service
 * 
 * Resolves WooCommerce merge tags in email templates with actual order/customer data.
 * Extracted from MarketingService.ts for maintainability.
 */

interface MergeTagContext {
    order?: any;
    customer?: any;
    product?: any;
    coupon?: any;
}

/**
 * Replace WooCommerce merge tags with actual order/customer data.
 * Called before sending marketing emails with order context.
 */
export function resolveMergeTags(html: string, context: MergeTagContext): string {
    let result = html;

    // Order merge tags
    if (context.order) {
        const order = context.order;

        result = result.replace(/\{\{order\.number\}\}/g, order.orderNumber || order.id || '');
        result = result.replace(/\{\{order\.date\}\}/g, formatDate(order.dateCreated));
        result = result.replace(/\{\{order\.status\}\}/g, formatStatus(order.status));
        result = result.replace(/\{\{order\.paymentMethod\}\}/g, order.paymentMethodTitle || '');
        result = result.replace(/\{\{order\.subtotal\}\}/g, formatCurrency(order.subtotal, order.currency));
        result = result.replace(/\{\{order\.shippingTotal\}\}/g, formatCurrency(order.shippingTotal, order.currency));
        result = result.replace(/\{\{order\.discountTotal\}\}/g, formatCurrency(order.discountTotal, order.currency));
        result = result.replace(/\{\{order\.total\}\}/g, formatCurrency(order.total, order.currency));
        result = result.replace(/\{\{order\.customerNote\}\}/g, order.customerNote || '');

        // Address blocks
        result = result.replace(/\{\{order\.billingAddress\}\}/g, formatAddress(order.billingAddress || order.billing));
        result = result.replace(/\{\{order\.shippingAddress\}\}/g, formatAddress(order.shippingAddress || order.shipping));

        // Items table
        result = result.replace(/\{\{order\.itemsTable\}\}/g, renderOrderItemsTable(order.lineItems || order.items || []));

        // Downloads
        result = result.replace(/\{\{order\.downloads\}\}/g, renderDownloadsTable(order.downloads || []));
    }

    // Customer merge tags
    if (context.customer) {
        const customer = context.customer;

        result = result.replace(/\{\{customer\.firstName\}\}/g, customer.firstName || customer.first_name || '');
        result = result.replace(/\{\{customer\.lastName\}\}/g, customer.lastName || customer.last_name || '');
        result = result.replace(/\{\{customer\.email\}\}/g, customer.email || '');
        result = result.replace(/\{\{customer\.phone\}\}/g, customer.phone || customer.billing?.phone || '');
    }

    // Product merge tags
    if (context.product) {
        const product = context.product;

        result = result.replace(/\{\{product\.name\}\}/g, product.name || '');
        result = result.replace(/\{\{product\.price\}\}/g, formatCurrency(product.price, 'AUD'));
        result = result.replace(/\{\{product\.image\}\}/g, product.images?.[0]?.src || '');
        result = result.replace(/\{\{product\.description\}\}/g, product.shortDescription || product.description || '');
    }

    // Coupon merge tags
    if (context.coupon) {
        const coupon = context.coupon;

        result = result.replace(/\{\{coupon\.code\}\}/g, coupon.code || '');
        result = result.replace(/\{\{coupon\.discount\}\}/g, coupon.discountType === 'percent'
            ? `${coupon.amount}%`
            : formatCurrency(coupon.amount, 'AUD'));
        result = result.replace(/\{\{coupon\.description\}\}/g, coupon.description || '');
    }

    return result;
}

/**
 * Format address object into HTML string.
 */
export function formatAddress(address: any): string {
    if (!address) return '';

    const parts = [
        [address.firstName, address.lastName].filter(Boolean).join(' ') ||
        [address.first_name, address.last_name].filter(Boolean).join(' '),
        address.company,
        address.address1 || address.address_1,
        address.address2 || address.address_2,
        [address.city, address.state, address.postcode].filter(Boolean).join(', '),
        address.country
    ].filter(Boolean);

    return parts.join('<br>');
}

/**
 * Render order line items as HTML table.
 */
export function renderOrderItemsTable(items: any[]): string {
    if (!items || items.length === 0) {
        return '<p style="color: #6b7280; font-style: italic;">No items</p>';
    }

    const rows = items.map(item => `
        <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; vertical-align: top;">
                ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;" />` : ''}
            </td>
            <td style="padding: 12px; color: #374151;">
                ${item.name || item.productName || 'Product'}
                ${item.meta?.length ? `<br><span style="font-size: 12px; color: #6b7280;">${item.meta.map((m: any) => `${m.key}: ${m.value}`).join(', ')}</span>` : ''}
            </td>
            <td style="padding: 12px; text-align: center; color: #374151;">${item.quantity || 1}</td>
            <td style="padding: 12px; text-align: right; color: #374151;">${formatCurrency(item.total || item.price, item.currency)}</td>
        </tr>
    `).join('');

    return `
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-family: Arial, sans-serif;">
            <thead>
                <tr style="background: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; width: 60px;"></th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Product</th>
                    <th style="padding: 12px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase; width: 60px;">Qty</th>
                    <th style="padding: 12px; text-align: right; font-size: 12px; color: #6b7280; text-transform: uppercase; width: 100px;">Price</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

/**
 * Render downloadable products as HTML.
 */
export function renderDownloadsTable(downloads: any[]): string {
    if (!downloads || downloads.length === 0) {
        return '<p style="color: #6b7280; font-style: italic;">No downloads available</p>';
    }

    const items = downloads.map(dl => `
        <div style="padding: 16px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
            <div>
                <p style="margin: 0 0 4px 0; color: #111827; font-size: 14px; font-weight: 500;">${dl.name || dl.product_name || 'Download'}</p>
                ${dl.access_expires ? `<p style="margin: 0; color: #6b7280; font-size: 12px;">Expires: ${formatDate(dl.access_expires)}</p>` : ''}
            </div>
            <a href="${dl.download_url || dl.file?.file || '#'}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500;">Download</a>
        </div>
    `).join('');

    return `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; font-family: Arial, sans-serif;">
            ${items}
        </div>
    `;
}

/**
 * Format currency value.
 */
export function formatCurrency(amount: number | string | undefined, currency: string = 'AUD'): string {
    if (amount === undefined || amount === null) return '$0.00';

    const num = typeof amount === 'string' ? parseFloat(amount) : amount;

    return new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: currency || 'AUD'
    }).format(num);
}

/**
 * Format date for display.
 */
export function formatDate(date: string | Date | undefined): string {
    if (!date) return '';

    const d = typeof date === 'string' ? new Date(date) : date;

    return d.toLocaleDateString('en-AU', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Format order status for display.
 */
export function formatStatus(status: string | undefined): string {
    if (!status) return '';

    const statusMap: Record<string, string> = {
        'pending': 'Pending Payment',
        'processing': 'Processing',
        'on-hold': 'On Hold',
        'completed': 'Completed',
        'cancelled': 'Cancelled',
        'refunded': 'Refunded',
        'failed': 'Failed'
    };

    return statusMap[status.toLowerCase()] || status.charAt(0).toUpperCase() + status.slice(1);
}
