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
        const tagName = getMergeTagName(tag);
        if (tagName) {
            result = result.replace(createMergeTagPattern(tagName), (_match, fallbackValue) => value || parseFallbackValue(fallbackValue));
        }

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
    if (preferencesUrl) replaceMergeTag('{{preferences_url}}', preferencesUrl);
    const unsubscribeUrl = context.unsubscribeUrl || context.unsubscribe_url || '';
    if (unsubscribeUrl) replaceMergeTag('{{unsubscribe_url}}', unsubscribeUrl);

    // Order merge tags
    if (context.order) {
        const order = context.order;

        const orderNumber = order.orderNumber || order.order_number || order.number || order.id || '';
        const orderDate = order.dateCreated || order.date_created || order.date_created_gmt || order.createdAt || order.created_at;
        const billingAddress = order.billingAddress || order.billing_address || order.billing;
        const shippingAddress = order.shippingAddress || order.shipping_address || order.shipping || billingAddress;
        const orderItems = getOrderItems(order);

        replaceMergeTag('{{order.number}}', orderNumber);
        replaceMergeTag('{{order_id}}', orderNumber);
        replaceMergeTag('{{order.date}}', formatDate(orderDate));
        replaceMergeTag('{{order.status}}', formatStatus(order.status));
        replaceMergeTag('{{order.paymentMethod}}', order.paymentMethodTitle || order.payment_method_title || order.paymentMethod || order.payment_method || '');
        replaceMergeTag('{{order.subtotal}}', formatCurrency(order.subtotal ?? order.sub_total, order.currency));
        replaceMergeTag('{{order.shippingTotal}}', formatCurrency(order.shippingTotal ?? order.shipping_total, order.currency));
        replaceMergeTag('{{order.discountTotal}}', formatCurrency(order.discountTotal ?? order.discount_total, order.currency));
        replaceMergeTag('{{order.taxTotal}}', formatCurrency(order.taxTotal ?? order.tax_total ?? order.totalTax ?? order.total_tax, order.currency));
        replaceMergeTag('{{order.total}}', formatCurrency(order.total, order.currency));
        replaceMergeTag('{{order.customerNote}}', order.customerNote || order.customer_note || '');

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
        const formattedBillingAddress = formatAddress(billingAddress);
        const formattedShippingAddress = formatAddress(shippingAddress) || formattedBillingAddress;
        replaceMergeTag('{{order.billingAddress}}', formattedBillingAddress);
        replaceMergeTag('{{order.shippingAddress}}', formattedShippingAddress);

        // Items table
        replaceMergeTag('{{order.itemsTable}}', renderOrderItemsTable(orderItems));
        replaceMergeTag('{{order.itemsCompact}}', renderOrderItemsCompact(orderItems));
        replaceMergeTag('{{order.itemsList}}', renderOrderItemsList(orderItems));
        replaceMergeTag('{{order.reviewLinks}}', renderOrderReviewLinks(orderItems, storeUrl, getReviewPrefill(context)));
        result = result.replace(/\{\{\s*order_items(?:\s+[^}]*)?\s*\}\}/g, renderOrderItemsText(orderItems));

        // Downloads
        replaceMergeTag('{{order.downloads}}', renderDownloadsTable(order.downloads || []));

        const invoiceUrl = getInvoiceUrl(order, storeUrl);
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
    const product = getProductMergeContext(context);
    if (product) {
        replaceMergeTag('{{product.name}}', product.name || '');
        replaceMergeTag('{{product.price}}', formatCurrency(product.price, product.currency || context.order?.currency || context.cart?.currency || 'AUD'));
        replaceMergeTag('{{product.image}}', getProductImageUrl(product));
        replaceMergeTag('{{product.description}}', product.shortDescription || product.short_description || product.description || '');
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
    const reviewFallback = getReviewFallback(context, storeUrl);
    const explicitReviewUrl = getExplicitReviewUrl(context, storeUrl);
    const reviewPrefill = getReviewPrefill(context);
    const reviewRequestUrl = buildReviewRequestUrl(
        explicitReviewUrl || getReviewProductUrl(
            context.review?.requestUrl || context.review?.request_url || context.review?.productUrl || context.review?.product_url,
            reviewFallback.productUrl,
            storeUrl
        ),
        undefined,
        reviewPrefill
    );
    if (context.review) {
        const review = context.review;
        replaceMergeTag('{{review.reviewer}}', review.reviewer || review.reviewerName || '');
        replaceMergeTag('{{review.rating}}', review.rating ? String(review.rating) : '');
        replaceMergeTag('{{review.content}}', review.content || review.review || '');
        replaceMergeTag('{{review.productName}}', review.productName || review.product_name || reviewFallback.productName);
        replaceMergeTag('{{review.url}}', explicitReviewUrl || getReviewProductUrl(review.reviewUrl || review.review_url, reviewFallback.productUrl, storeUrl));
        replaceMergeTag('{{review.productUrl}}', explicitReviewUrl || getReviewProductUrl(review.productUrl || review.product_url, reviewFallback.productUrl, storeUrl));
        replaceMergeTag('{{review.requestUrl}}', reviewRequestUrl);
    } else {
        const reviewer = [
            context.customer?.firstName || context.customer?.first_name,
            context.customer?.lastName || context.customer?.last_name,
        ].filter(Boolean).join(' ').trim();

        replaceMergeTag('{{review.reviewer}}', reviewer || 'Customer');
        replaceMergeTag('{{review.rating}}', '5');
        replaceMergeTag('{{review.content}}', 'Thanks for your order. We would love to hear your feedback.');
        replaceMergeTag('{{review.productName}}', reviewFallback.productName || 'your recent purchase');
        replaceMergeTag('{{review.url}}', explicitReviewUrl || getReviewProductUrl('', reviewFallback.productUrl, storeUrl));
        replaceMergeTag('{{review.productUrl}}', explicitReviewUrl || getReviewProductUrl('', reviewFallback.productUrl, storeUrl));
        replaceMergeTag('{{review.requestUrl}}', reviewRequestUrl);
    }
    for (let rating = 1; rating <= 5; rating++) {
        replaceMergeTag(`{{review.star${rating}Url}}`, buildReviewRequestUrl(reviewRequestUrl, rating, reviewPrefill));
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

    return replaceFallbackOnlyTags(result);
}

function getMergeTagName(tag: string): string {
    return tag.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
}

function createMergeTagPattern(tagName: string): RegExp {
    const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\{\\{\\s*${escapedTagName}\\s*(?:\\|\\s*fallback\\s*:\\s*((?:"[^"]*")|(?:'[^']*')|[^}]*?))?\\s*\\}\\}`, 'g');
}

function replaceFallbackOnlyTags(value: string): string {
    return value.replace(/\{\{\s*[^}|]+\s*\|\s*fallback\s*:\s*((?:"[^"]*")|(?:'[^']*')|[^}]*?)\s*\}\}/g, (_match, fallbackValue) => parseFallbackValue(fallbackValue));
}

function parseFallbackValue(value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

export function applyPreviewText(html: string, previewText: string): string {
    const trimmedPreviewText = String(previewText || '').trim();
    if (!trimmedPreviewText) return html;

    const preheader = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(trimmedPreviewText)}</div>`;
    const withoutDesignerPreheader = html.replace(
        /<div\s+style=["']display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;?["']>[\s\S]*?<\/div>\s*/i,
        ''
    );

    if (/<body\b[^>]*>/i.test(withoutDesignerPreheader)) {
        return withoutDesignerPreheader.replace(/<body\b[^>]*>/i, (bodyTag) => `${bodyTag}\n  ${preheader}`);
    }

    return `${preheader}${withoutDesignerPreheader}`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

function withReviewAnchor(url: string): string {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';
    return buildReviewRequestUrl(trimmed.replace(/\/$/, ''));
}

function buildReviewRequestUrl(rawUrl: string, rating?: number, prefill?: { name?: string; email?: string }): string {
    const url = String(rawUrl || '').trim();
    if (!url) return '';

    try {
        const parsed = new URL(url);
        parsed.searchParams.set('overseek_review_request', '1');
        if (rating) parsed.searchParams.set('overseek_review_rating', String(rating));
        if (prefill?.name) parsed.searchParams.set('overseek_review_name', prefill.name);
        if (prefill?.email) parsed.searchParams.set('overseek_review_email', prefill.email);
        if (!parsed.hash) parsed.hash = 'review_form';
        return parsed.toString();
    } catch {
        const [withoutHash, hash = 'review_form'] = url.split('#');
        const separator = withoutHash.includes('?') ? '&' : '?';
        const ratingParam = rating ? `&overseek_review_rating=${encodeURIComponent(String(rating))}` : '';
        const nameParam = prefill?.name ? `&overseek_review_name=${encodeURIComponent(prefill.name)}` : '';
        const emailParam = prefill?.email ? `&overseek_review_email=${encodeURIComponent(prefill.email)}` : '';
        return `${withoutHash}${separator}overseek_review_request=1${ratingParam}${nameParam}${emailParam}#${hash || 'review_form'}`;
    }
}

function getReviewPrefill(context: MergeTagContext): { name?: string; email?: string } {
    const customer = context.customer || {};
    const order = context.order || {};
    const billing = order.billing || order.billingAddress || order.billing_address || {};
    const review = context.review || {};

    const firstName = firstString(
        customer.firstName,
        customer.first_name,
        billing.first_name,
        billing.firstName,
        order.billingFirstName,
        order.billing_first_name
    );
    const lastName = firstString(
        customer.lastName,
        customer.last_name,
        billing.last_name,
        billing.lastName,
        order.billingLastName,
        order.billing_last_name
    );
    const name = firstString(
        review.reviewer,
        review.reviewerName,
        review.reviewer_name,
        customer.name,
        customer.fullName,
        customer.full_name,
        [firstName, lastName].filter(Boolean).join(' '),
        billing.name,
        billing.fullName,
        billing.full_name
    );
    const email = firstString(
        review.reviewerEmail,
        review.reviewer_email,
        customer.email,
        billing.email,
        order.billingEmail,
        order.billing_email,
        order.email
    );

    return { name, email };
}

function firstString(...values: unknown[]): string {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) return normalized;
    }

    return '';
}

function getReviewProductUrl(rawReviewUrl: unknown, fallbackUrl: string, storeUrl: string): string {
    const reviewUrl = String(rawReviewUrl || '').trim();
    if (reviewUrl && !isStoreHomepageUrl(reviewUrl, storeUrl)) {
        return withReviewAnchor(reviewUrl);
    }
    return withReviewAnchor(fallbackUrl || reviewUrl || storeUrl);
}

function getExplicitReviewUrl(context: MergeTagContext, storeUrl: string): string {
    const review = context.review || {};
    const directReviewUrl = firstUrl(
        review.url,
        review.reviewUrl,
        review.review_url,
        review.reminderUrl,
        review.reminder_url,
        review.cusRevUrl,
        review.cusrevUrl,
        review.cusrev_url,
        context.order?.reviewUrl,
        context.order?.review_url,
        context.order?.reviewReminderUrl,
        context.order?.review_reminder_url,
        context.order?.cusRevUrl,
        context.order?.cusrevUrl,
        context.order?.cusrev_url,
        findReviewUrlInMetadata(context.order?.meta_data || context.order?.metaData),
        findReviewUrlInMetadata(context.order?.rawData?.meta_data || context.order?.raw_data?.meta_data)
    );

    return directReviewUrl && !isStoreHomepageUrl(directReviewUrl, storeUrl) ? directReviewUrl : '';
}

function findReviewUrlInMetadata(metaData: unknown): string {
    if (!Array.isArray(metaData)) return '';

    for (const meta of metaData) {
        if (!meta || typeof meta !== 'object') continue;
        const record = meta as Record<string, unknown>;
        const key = String(record.key || record.name || '').toLowerCase();
        if (!/(cusrev|ivole|review).*url|url.*(cusrev|ivole|review)|review.*link|link.*review|reminder.*link|reminder.*url/.test(key)) continue;

        const url = firstUrl(record.value, record.display_value);
        if (url) return url;
    }

    return '';
}

function firstUrl(...values: unknown[]): string {
    for (const value of values) {
        const url = findUrl(value);
        if (url) return url;
    }

    return '';
}

function findUrl(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') {
        const direct = value.trim();
        if (/^https?:\/\//i.test(direct)) return direct;
        const match = direct.match(/https?:\/\/[^\s"'<>]+/i);
        return match?.[0] || '';
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const url = findUrl(item);
            if (url) return url;
        }
    }
    if (typeof value === 'object') {
        for (const item of Object.values(value as Record<string, unknown>)) {
            const url = findUrl(item);
            if (url) return url;
        }
    }

    return '';
}

function isStoreHomepageUrl(rawUrl: string, storeUrl: string): boolean {
    if (!rawUrl || !storeUrl) return false;

    try {
        const parsedUrl = new URL(rawUrl);
        const parsedStoreUrl = new URL(storeUrl);
        const normalizedPath = parsedUrl.pathname.replace(/\/$/, '') || '/';
        const normalizedStorePath = parsedStoreUrl.pathname.replace(/\/$/, '') || '/';

        return parsedUrl.origin === parsedStoreUrl.origin
            && normalizedPath === normalizedStorePath
            && !parsedUrl.search
            && !parsedUrl.hash;
    } catch {
        return rawUrl.replace(/\/$/, '') === storeUrl.replace(/\/$/, '');
    }
}

function getReviewFallback(context: MergeTagContext, storeUrl: string): { productName: string; productUrl: string } {
    const product = context.product || {};
    const order = context.order || {};
    const orderItems = getOrderItems(order);
    const firstItem = Array.isArray(orderItems) ? orderItems[0] : null;
    const productName = product.name || firstItem?.name || '';
    const directProductUrl = product.permalink || product.url || product.productUrl || firstItem?.permalink || firstItem?.productUrl || firstItem?.product_url;

    if (directProductUrl) {
        return { productName, productUrl: withReviewAnchor(directProductUrl) };
    }

    const productId = product.id || product.productId || product.product_id || firstItem?.product_id || firstItem?.productId;
    if (storeUrl && productId) {
        return { productName, productUrl: buildReviewRequestUrl(`${storeUrl.replace(/\/$/, '')}/?p=${encodeURIComponent(String(productId))}`) };
    }

    return { productName, productUrl: storeUrl };
}

function getOrderItems(order: any): any[] {
    const items = order?.lineItems || order?.line_items || order?.items || order?.orderItems || order?.order_items || [];
    return Array.isArray(items) ? items : [];
}

function getProductMergeContext(context: MergeTagContext): any | null {
    if (context.product) return context.product;

    const orderItems = getOrderItems(context.order);
    const cartItems = Array.isArray(context.cart?.items)
        ? context.cart.items
        : Array.isArray(context.cart?.cartItems)
            ? context.cart.cartItems
            : [];
    const item = orderItems[0] || cartItems[0];

    if (!item) return null;

    return {
        ...item,
        id: item.id || item.productId || item.product_id,
        productId: item.productId || item.product_id || item.id,
        name: item.name || item.productName || item.product_name || '',
        price: item.price ?? item.total ?? item.subtotal ?? item.lineTotal ?? item.line_total,
        currency: item.currency || context.order?.currency || context.cart?.currency,
        description: item.description || item.shortDescription || item.short_description || '',
    };
}

function getProductImageUrl(product: any): string {
    const image = product.image || product.images?.[0] || product.thumbnail || product.thumbnailUrl || product.thumbnail_url;
    if (typeof image === 'string') return image;
    if (image && typeof image === 'object') return image.src || image.url || '';
    return '';
}

function renderOrderReviewLinks(items: any[], storeUrl: string, prefill?: { name?: string; email?: string }): string {
    if (!Array.isArray(items) || items.length === 0) return '';

    const rows = items
        .map((item) => {
            const name = escapeHtml(String(item?.name || item?.productName || item?.product_name || 'Review product'));
            const directUrl = item?.permalink || item?.productUrl || item?.product_url || item?.url;
            const productId = item?.product_id || item?.productId || item?.id;
            const fallbackUrl = storeUrl && productId
                ? buildReviewRequestUrl(`${storeUrl.replace(/\/$/, '')}/?p=${encodeURIComponent(String(productId))}`)
                : storeUrl;
            const reviewUrl = buildReviewRequestUrl(getReviewProductUrl(directUrl, fallbackUrl, storeUrl), undefined, prefill);
            if (!reviewUrl) return '';
            return `<li><a href="${escapeHtml(reviewUrl)}">${name}</a></li>`;
        })
        .filter(Boolean)
        .join('');

    return rows ? `<ul>${rows}</ul>` : '';
}

function getInvoiceUrl(order: any, storeUrl: string): string {
    const directUrl = order.invoiceUrl
        || order.invoice_url
        || order.pdfUrl
        || order.pdf_url
        || order.invoice?.invoiceUrl
        || order.invoice?.invoice_url
        || order.invoice?.pdfUrl
        || order.invoice?.pdf_url
        || order.invoice?.downloadUrl
        || order.invoice?.download_url
        || order.invoice?.url;

    if (directUrl) return String(directUrl);

    const orderId = order.id || order.orderId || order.order_id || order.wooId || order.woo_id;
    const orderKey = order.orderKey || order.order_key || order.key;
    if (storeUrl && orderId && orderKey) {
        const base = `${storeUrl.replace(/\/$/, '')}/wp-json/overseek/v1/invoices/download`;
        return `${base}?order_id=${encodeURIComponent(String(orderId))}&order_key=${encodeURIComponent(String(orderKey))}`;
    }

    return order.viewOrderUrl || order.view_order_url || order.orderUrl || order.order_url || '';
}

function getOrderItemImageUrl(item: any): string {
    const image = item?.image;
    if (typeof image === 'string') return image;
    if (image?.src) return String(image.src);
    if (image?.url) return String(image.url);

    const images = item?.images;
    if (Array.isArray(images) && images.length > 0) {
        const firstImage = images[0];
        if (typeof firstImage === 'string') return firstImage;
        if (firstImage?.src) return String(firstImage.src);
        if (firstImage?.url) return String(firstImage.url);
    }

    return item?.productImage
        || item?.product_image
        || item?.thumbnail
        || item?.thumbnail_url
        || '';
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
        const itemName = item.name || item.productName || item.product_name || 'Product';
        const imageUrl = getOrderItemImageUrl(item);
        const quantity = item.quantity || 1;
        const itemTotal = formatCurrency(item.total || item.price, item.currency);
        const itemTax = formatCurrency(getOrderItemTaxTotal(item), item.currency);
        const derivedMeta = getInvoiceItemMeta(item)
            .filter((entry) => String(entry?.value || '').trim().length > 0)
            .slice(0, 12)
            .map((entry) => `${entry.label}: ${entry.value}`)
            .join('<br>');
        const fallbackMeta = item.meta?.length
            ? item.meta.map((m: any) => `${m.key}: ${m.value}`).join(', ')
            : '';
        const itemMeta = derivedMeta || fallbackMeta;

        return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px; color: #374151; vertical-align: top; width: 70%;">
                ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(itemName)}" width="50" height="50" style="display: inline-block; width: 50px; height: 50px; object-fit: cover; border-radius: 4px; margin: 0 10px 8px 0; vertical-align: top;" />` : ''}
                <span style="display: inline-block; max-width: 100%; vertical-align: top; line-height: 1.35; word-break: break-word;">
                    <strong style="font-weight: 500; color: #374151;">${escapeHtml(itemName)}</strong>
                    ${itemMeta ? `<br><span style="font-size: 12px; color: #6b7280;">${itemMeta}</span>` : ''}
                </span>
            </td>
            <td style="padding: 12px 8px; text-align: center; color: #374151; vertical-align: top; width: 44px; white-space: nowrap;">${quantity}</td>
            <td style="padding: 12px 8px; text-align: right; color: #374151; vertical-align: top; width: 86px; white-space: nowrap;">
                ${itemTotal}<br><span style="font-size: 12px; color: #6b7280;">GST: ${itemTax}</span>
            </td>
        </tr>
    `;
    }).join('');

    return `
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-family: Arial, sans-serif;">
            <thead>
                <tr style="background: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; width: 70%;">Product</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase; width: 44px;">Qty</th>
                    <th style="padding: 12px 8px; text-align: right; font-size: 12px; color: #6b7280; text-transform: uppercase; width: 86px;">Price</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

export function renderOrderItemsCompact(items: any[]): string {
    if (!items || items.length === 0) {
        return '<p style="color: #6b7280; font-style: italic;">No items</p>';
    }

    return `<div style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; font-family: Arial, sans-serif;">${items.map((item) => {
        const name = item.name || item.productName || item.product_name || 'Product';
        const quantity = item.quantity || 1;
        const total = formatCurrency(item.total || item.price, item.currency);
        const tax = formatCurrency(getOrderItemTaxTotal(item), item.currency);
        return `<div style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #374151;"><strong>${escapeHtml(String(name))}</strong><br><span style="font-size: 13px; color: #6b7280;">Qty: ${escapeHtml(String(quantity))} &middot; ${total} &middot; GST: ${tax}</span></div>`;
    }).join('')}</div>`;
}

function getOrderItemTaxTotal(item: any): number | string | undefined {
    const directTax = item.totalTax ?? item.total_tax ?? item.taxTotal ?? item.tax_total ?? item.tax;
    if (directTax !== undefined && directTax !== null && directTax !== '') return directTax;

    const taxes = item.taxes || item.tax_lines;
    if (!Array.isArray(taxes)) return undefined;

    return taxes.reduce((sum, taxLine) => sum + (parseFloat(String(taxLine?.total ?? taxLine?.subtotal ?? 0)) || 0), 0);
}

export function renderOrderItemsList(items: any[]): string {
    if (!items || items.length === 0) {
        return '<p style="color: #6b7280; font-style: italic;">No items</p>';
    }

    return `<ul style="margin: 0; padding-left: 20px; color: #374151; line-height: 1.6; font-family: Arial, sans-serif;">${items.map((item) => {
        const name = item.name || item.productName || item.product_name || 'Product';
        const quantity = item.quantity || 1;
        return `<li>${quantity} x ${name}</li>`;
    }).join('')}</ul>`;
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
