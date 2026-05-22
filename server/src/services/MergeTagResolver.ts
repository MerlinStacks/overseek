/**
 * Merge Tag Resolver Service
 * 
 * Resolves WooCommerce merge tags in email templates with actual order/customer data.
 * Extracted from MarketingService.ts for maintainability.
 */

import { normalizeOrderStatus } from '../constants/orderStatus';
import { getInvoiceItemMeta } from '@overseek/core';
import { extractOrderTracking, TrackingItem } from '../utils/orderTracking';

interface MergeTagContext {
    order?: any;
    customer?: any;
    product?: any;
    coupon?: any;
    review?: any;
    cart?: any;
    shipment?: any;
    store?: {
        url?: string;
    };
    linkTriggerUrl?: string;
    link_trigger?: string;
    storeUrl?: string;
    store_url?: string;
    preferencesUrl?: string;
    preferences_url?: string;
    unsubscribeUrl?: string;
    unsubscribe_url?: string;
}

/**
 * Replace WooCommerce merge tags with actual order/customer data.
 * Called before sending marketing emails with order context.
 */
export function resolveMergeTags(html: string, context: MergeTagContext): string {
    let result = html;

    const replaceMergeTag = (tag: string, value: string): void => {
        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`https?:\\/\\/[^\\s"'<>]+\\/${escapedTag}`, 'gi'), value);
        result = result.replace(new RegExp(escapedTag, 'g'), value);

        const encodedTag = encodeURIComponent(tag);
        const escapedEncodedTag = encodedTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`https?:\\/\\/[^\\s"'<>]+\\/${escapedEncodedTag}`, 'gi'), value);
        result = result.replace(new RegExp(escapedEncodedTag, 'gi'), value);
    };

    const storeUrl = normalizeStoreUrl(
        context.store?.url || context.storeUrl || context.store_url || context.order?.storeUrl || context.order?.store_url
    );
    replaceMergeTag('{{store_url}}', storeUrl);
    const linkTriggerUrl = normalizeStoreUrl(context.linkTriggerUrl || context.link_trigger) || storeUrl;
    replaceMergeTag('{{link_trigger}}', linkTriggerUrl);
    const preferencesUrl = context.preferencesUrl || context.preferences_url || '';
    replaceMergeTag('{{preferences_url}}', preferencesUrl);
    const unsubscribeUrl = context.unsubscribeUrl || context.unsubscribe_url || (storeUrl ? `${storeUrl.replace(/\/$/, '')}/?unsubscribe=1` : '');
    replaceMergeTag('{{unsubscribe_url}}', unsubscribeUrl);

    // Order merge tags
    if (context.order) {
        const order = context.order;

        replaceMergeTag('{{order.number}}', order.orderNumber || order.id || '');
        replaceMergeTag('{{order_id}}', order.orderNumber || order.id || '');
        replaceMergeTag('{{order.date}}', formatDate(order.dateCreated));
        replaceMergeTag('{{order.status}}', formatStatus(order.status));
        replaceMergeTag('{{order.paymentMethod}}', order.paymentMethodTitle || '');
        replaceMergeTag('{{order.subtotal}}', formatCurrency(order.subtotal, order.currency));
        replaceMergeTag('{{order.shippingTotal}}', formatCurrency(order.shippingTotal, order.currency));
        replaceMergeTag('{{order.discountTotal}}', formatCurrency(order.discountTotal, order.currency));
        replaceMergeTag('{{order.total}}', formatCurrency(order.total, order.currency));
        replaceMergeTag('{{order.customerNote}}', order.customerNote || '');

        const trackingItems = getOrderTrackingItems(order);
        const primaryTracking = trackingItems[0];
        const trackingNumber = primaryTracking?.trackingNumber || '';
        const trackingUrl = primaryTracking?.trackingUrl || buildAusPostTrackingUrl(trackingNumber);
        replaceMergeTag('{{order.trackingNumber}}', trackingNumber);
        replaceMergeTag('{{order.trackingUrl}}', trackingUrl);
        replaceMergeTag('{{order.auspostTrackingUrl}}', buildAusPostTrackingUrl(trackingNumber));
        replaceMergeTag('{{tracking_number}}', trackingNumber);
        replaceMergeTag('{{tracking_url}}', trackingUrl);

        // Address blocks
        replaceMergeTag('{{order.billingAddress}}', formatAddress(order.billingAddress || order.billing));
        replaceMergeTag('{{order.shippingAddress}}', formatAddress(order.shippingAddress || order.shipping));

        // Items table
        const orderItems = order.lineItems || order.items || order.line_items || [];
        replaceMergeTag('{{order.itemsTable}}', renderOrderItemsTable(orderItems));
        result = result.replace(/\{\{\s*order_items(?:\s+[^}]*)?\s*\}\}/g, renderOrderItemsText(orderItems));

        // Downloads
        replaceMergeTag('{{order.downloads}}', renderDownloadsTable(order.downloads || []));

        const invoiceUrl =
            order.invoiceUrl
            || order.invoice_url
            || order.pdfUrl
            || order.pdf_url
            || '';
        replaceMergeTag('{{order.invoiceUrl}}', invoiceUrl);
        replaceMergeTag('{{invoice_url}}', invoiceUrl);
        replaceMergeTag('{{pdf_url}}', invoiceUrl);
    }

    result = result.replace(/\{\{\s*order_items(?:\s+[^}]*)?\s*\}\}/g, 'your order');

    // Customer merge tags
    if (context.customer) {
        const customer = context.customer;

        const firstName = customer.firstName || customer.first_name || '';
        const lastName = customer.lastName || customer.last_name || '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

        replaceMergeTag('{{customer.firstName}}', firstName);
        replaceMergeTag('{{customer.lastName}}', lastName);
        replaceMergeTag('{{customer.email}}', customer.email || '');
        replaceMergeTag('{{customer.phone}}', customer.phone || customer.billing?.phone || '');
        replaceMergeTag('{{contact_first_name}}', firstName);
        replaceMergeTag('{{contact_last_name}}', lastName);
        replaceMergeTag('{{contact_email}}', customer.email || '');
        replaceMergeTag('{{contact_full_name}}', fullName);
        replaceMergeTag('{{contact_id}}', customer.id ? String(customer.id) : '');
    }

    // Product merge tags
    if (context.product) {
        const product = context.product;

        replaceMergeTag('{{product.name}}', product.name || '');
        replaceMergeTag('{{product.price}}', formatCurrency(product.price, 'AUD'));
        replaceMergeTag('{{product.image}}', product.images?.[0]?.src || '');
        replaceMergeTag('{{product.description}}', product.shortDescription || product.description || '');
    }

    // Coupon merge tags
    if (context.coupon) {
        const coupon = context.coupon;

        replaceMergeTag('{{coupon.code}}', coupon.code || '');
        replaceMergeTag('{{coupon.discount}}', coupon.discountType === 'percent'
            ? `${coupon.amount}%`
            : formatCurrency(coupon.amount, 'AUD'));
        replaceMergeTag('{{coupon.description}}', coupon.description || '');
        replaceMergeTag('{{coupon.expiry}}', formatDate(coupon.expiresAt));
    }

    // Cart merge tags
    if (context.cart) {
        const cart = context.cart;
        replaceMergeTag('{{cart.recoveryUrl}}', cart.recoveryUrl || '');
        replaceMergeTag('{{cart.checkoutUrl}}', cart.checkoutUrl || '');
        replaceMergeTag('{{cart.total}}', formatCurrency(cart.total ?? cart.cartValue, cart.currency));
        replaceMergeTag('{{cart.currency}}', cart.currency || '');
        replaceMergeTag('{{cart.itemsTable}}', renderOrderItemsTable(cart.items || cart.cartItems || []));
    }

    // Review merge tags
    if (context.review) {
        const review = context.review;
        replaceMergeTag('{{review.reviewer}}', review.reviewer || review.reviewerName || '');
        replaceMergeTag('{{review.rating}}', review.rating ? String(review.rating) : '');
        replaceMergeTag('{{review.content}}', review.content || review.review || '');
        replaceMergeTag('{{review.productName}}', review.productName || review.product_name || '');
        replaceMergeTag('{{review.productUrl}}', review.productUrl || review.product_url || '');
    } else {
        const reviewer = [
            context.customer?.firstName || context.customer?.first_name,
            context.customer?.lastName || context.customer?.last_name,
        ].filter(Boolean).join(' ').trim();
        const fallbackProductUrl = context.product?.permalink || context.product?.url || storeUrl;

        replaceMergeTag('{{review.reviewer}}', reviewer || 'Customer');
        replaceMergeTag('{{review.rating}}', '5');
        replaceMergeTag('{{review.content}}', 'Thanks for your order. We would love to hear your feedback.');
        replaceMergeTag('{{review.productName}}', context.product?.name || 'your recent purchase');
        replaceMergeTag('{{review.productUrl}}', fallbackProductUrl || storeUrl);
    }

    // Shipment merge tags
    if (context.shipment) {
        const shipment = context.shipment;
        result = result.replace(/\{\{shipment\.trackingNumber\}\}/g, shipment.trackingNumber || '');
        result = result.replace(/\{\{shipment\.trackingUrl\}\}/g, shipment.trackingUrl || '');
        result = result.replace(/\{\{shipment\.carrier\}\}/g, shipment.carrier || '');
        result = result.replace(/\{\{shipment\.serviceName\}\}/g, shipment.serviceName || '');
        result = result.replace(/\{\{shipment\.status\}\}/g, shipment.status ? String(shipment.status).replace(/_/g, ' ') : '');
        result = result.replace(/\{\{shipment\.latestScanDescription\}\}/g, shipment.latestScanDescription || '');
        result = result.replace(/\{\{shipment\.latestScanLocation\}\}/g, shipment.latestScanLocation || '');
        result = result.replace(/\{\{shipment\.latestScanTime\}\}/g, formatDate(shipment.latestScanTime));
    }

    return result;
}

function normalizeStoreUrl(rawUrl?: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

function buildAusPostTrackingUrl(trackingNumber: string): string {
    const trimmed = String(trackingNumber || '').trim();
    if (!trimmed) return '';
    return `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(trimmed)}`;
}

function getOrderTrackingItems(order: any): TrackingItem[] {
    const directItems = order.trackingItems || order.tracking_items || order.shipments || order.shipmentTracking;
    if (Array.isArray(directItems) && directItems.length > 0) {
        return directItems
            .map((item) => {
                const trackingNumber = String(item?.trackingNumber || item?.tracking_number || item?.number || '').trim();
                if (!trackingNumber) return null;
                return {
                    provider: String(item?.provider || item?.tracking_provider || item?.carrier || 'Unknown').trim(),
                    trackingNumber,
                    trackingUrl: item?.trackingUrl || item?.tracking_url || item?.tracking_link || null,
                    dateShipped: item?.dateShipped || item?.date_shipped || null,
                } as TrackingItem;
            })
            .filter((item): item is TrackingItem => Boolean(item));
    }

    const extracted = extractOrderTracking(order.rawData || order.raw_data || order);
    if (extracted.length > 0) return extracted;

    const trackingNumber = String(order.trackingNumber || order.tracking_number || order._tracking_number || '').trim();
    if (!trackingNumber) return [];

    return [{
        provider: String(order.trackingProvider || order.tracking_provider || order.shippingProvider || 'Unknown').trim(),
        trackingNumber,
        trackingUrl: order.trackingUrl || order.tracking_url || order.trackingLink || order.tracking_link || null,
        dateShipped: order.dateShipped || order.date_shipped || null,
    }];
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

    const rows = items.map(item => {
        const derivedMeta = getInvoiceItemMeta(item)
            .map((entry) => `${entry.label}: ${entry.value}`)
            .join(', ');
        const fallbackMeta = item.meta?.length
            ? item.meta.map((m: any) => `${m.key}: ${m.value}`).join(', ')
            : '';
        const itemMeta = derivedMeta || fallbackMeta;

        return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; vertical-align: top;">
                ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;" />` : ''}
            </td>
            <td style="padding: 12px; color: #374151;">
                ${item.name || item.productName || 'Product'}
                ${itemMeta ? `<br><span style="font-size: 12px; color: #6b7280;">${itemMeta}</span>` : ''}
            </td>
            <td style="padding: 12px; text-align: center; color: #374151;">${item.quantity || 1}</td>
            <td style="padding: 12px; text-align: right; color: #374151;">${formatCurrency(item.total || item.price, item.currency)}</td>
        </tr>
    `;
    }).join('');

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

function renderOrderItemsText(items: any[]): string {
    if (!items || items.length === 0) return 'your order';

    const names = items
        .map((item) => item.name || item.productName || item.product_name || item.title)
        .filter(Boolean)
        .map(String);

    if (names.length === 0) return 'your order';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
    const normalizedStatus = normalizeOrderStatus(status);

    const statusMap: Record<string, string> = {
        'pending': 'Pending Payment',
        'processing': 'Processing',
        'on-hold': 'On Hold',
        'completed': 'Completed',
        'cancelled': 'Cancelled',
        'refunded': 'Refunded',
        'failed': 'Failed'
    };

    return statusMap[normalizedStatus] || normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
}
