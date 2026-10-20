/**
 * WooCommerce Data Types
 * 
 * Type definitions for WooCommerce rawData JSON fields stored in Prisma.
 * These replace `as any` casts throughout the codebase for better type safety.
 */
import { z } from 'zod';


export interface WooOrderBillingAddress {
    first_name: string;
    last_name: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    email?: string;
    phone?: string;
}

export interface WooOrderShippingAddress {
    first_name: string;
    last_name: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
}

export interface WooOrderLineItem {
    id: number;
    name: string;
    product_id: number;
    variation_id?: number;
    quantity: number;
    tax_class?: string;
    subtotal: string;
    subtotal_tax: string;
    total: string;
    total_tax: string;
    taxes?: Array<{ id: number; total: string; subtotal: string }>;
    meta_data?: Array<{ id: number; key: string; value: unknown }>;
    sku?: string;
    price: number;
    image?: { id: number; src: string };
}

export interface WooOrderShippingLine {
    id: number;
    method_title: string;
    method_id: string;
    instance_id?: string;
    total: string;
    total_tax: string;
}

export interface WooOrderTaxLine {
    id: number;
    rate_code: string;
    rate_id: number;
    label: string;
    compound: boolean;
    tax_total: string;
    shipping_tax_total: string;
}

export interface WooOrderFeeLine {
    id: number;
    name: string;
    tax_class?: string;
    tax_status: string;
    amount: string;
    total: string;
    total_tax: string;
}

export interface WooOrderCouponLine {
    id: number;
    code: string;
    discount: string;
    discount_tax: string;
}

export interface WooOrderRefund {
    id: number;
    reason: string;
    total: string;
}

/**
 * WooCommerce Order Raw Data
 * Represents the complete order JSON from WooCommerce API v3
 */
export interface WooOrderRawData {
    id: number;
    parent_id?: number;
    status: string;
    currency: string;
    version?: string;
    prices_include_tax?: boolean;
    date_created: string;
    date_created_gmt: string;
    date_modified: string;
    date_modified_gmt: string;
    discount_total: string;
    discount_tax: string;
    shipping_total: string;
    shipping_tax: string;
    cart_tax: string;
    total: string;
    total_tax: string;
    customer_id: number;
    order_key?: string;
    billing: WooOrderBillingAddress;
    shipping: WooOrderShippingAddress;
    payment_method?: string;
    payment_method_title?: string;
    transaction_id?: string;
    customer_ip_address?: string;
    customer_user_agent?: string;
    created_via?: string;
    customer_note?: string;
    date_completed?: string | null;
    date_completed_gmt?: string | null;
    date_paid?: string | null;
    date_paid_gmt?: string | null;
    cart_hash?: string;
    number: string;
    meta_data?: Array<{ id: number; key: string; value: any }>;
    line_items: WooOrderLineItem[];
    tax_lines?: WooOrderTaxLine[];
    shipping_lines?: WooOrderShippingLine[];
    fee_lines?: WooOrderFeeLine[];
    coupon_lines?: WooOrderCouponLine[];
    refunds?: WooOrderRefund[];
}


export interface WooProductImage {
    id: number;
    date_created?: string;
    date_modified?: string;
    src: string;
    name?: string;
    alt?: string;
}

export interface WooProductCategory {
    id: number;
    name: string;
    slug: string;
}

export interface WooProductTag {
    id: number;
    name: string;
    slug: string;
}

export interface WooProductAttribute {
    id: number;
    name: string;
    position: number;
    visible: boolean;
    variation: boolean;
    options: string[];
}

export interface WooProductDimensions {
    length: string;
    width: string;
    height: string;
}

/**
 * WooCommerce Product Raw Data
 * Represents the complete product JSON from WooCommerce API v3
 */
export interface WooProductRawData {
    id: number;
    name: string;
    slug: string;
    permalink?: string;
    date_created: string;
    date_created_gmt: string;
    date_modified: string;
    date_modified_gmt: string;
    type: 'simple' | 'grouped' | 'external' | 'variable' | string; // Extended to support ATUM's custom types like 'variable-product-part'
    status: 'draft' | 'pending' | 'private' | 'publish';
    featured?: boolean;
    catalog_visibility?: 'visible' | 'catalog' | 'search' | 'hidden';
    description?: string;
    short_description?: string;
    sku: string;
    price: string;
    regular_price: string;
    sale_price?: string;
    date_on_sale_from?: string | null;
    date_on_sale_to?: string | null;
    price_html?: string;
    on_sale?: boolean;
    purchasable?: boolean;
    total_sales?: number;
    virtual?: boolean;
    downloadable?: boolean;
    external_url?: string;
    button_text?: string;
    tax_status?: 'taxable' | 'shipping' | 'none';
    tax_class?: string;
    manage_stock?: boolean;
    stock_quantity: number | null;
    stock_status: 'instock' | 'outofstock' | 'onbackorder';
    backorders?: 'no' | 'notify' | 'yes';
    backorders_allowed?: boolean;
    backordered?: boolean;
    sold_individually?: boolean;
    weight?: string;
    dimensions?: WooProductDimensions;
    shipping_required?: boolean;
    shipping_taxable?: boolean;
    shipping_class?: string;
    shipping_class_id?: number;
    reviews_allowed?: boolean;
    average_rating?: string;
    rating_count?: number;
    related_ids?: number[];
    upsell_ids?: number[];
    cross_sell_ids?: number[];
    parent_id?: number;
    purchase_note?: string;
    categories: WooProductCategory[];
    tags?: WooProductTag[];
    images: WooProductImage[];
    attributes?: WooProductAttribute[];
    variations?: number[];
    grouped_products?: number[];
    menu_order?: number;
    meta_data?: Array<{ id: number; key: string; value: any }>;
}


/**
 * WooCommerce Customer Raw Data
 */
export interface WooCustomerRawData {
    id: number;
    date_created: string;
    date_created_gmt: string;
    date_modified: string;
    date_modified_gmt: string;
    email: string;
    first_name: string;
    last_name: string;
    role?: string;
    username?: string;
    billing: WooOrderBillingAddress;
    shipping: WooOrderShippingAddress;
    is_paying_customer?: boolean;
    avatar_url?: string;
    meta_data?: Array<{ id: number; key: string; value: any }>;
}


/**
 * WooCommerce Review Raw Data
 */
export interface WooReviewRawData {
    id: number;
    date_created: string;
    date_created_gmt: string;
    product_id: number;
    status: 'approved' | 'hold' | 'spam' | 'unspam' | 'trash' | 'untrash';
    reviewer: string;
    reviewer_email: string;
    review: string;
    rating: number;
    verified: boolean;
    reviewer_avatar_urls?: Record<string, string>;
}


/**
 * Type guard - use when accessing rawData from Prisma models
 * @example
 * const orderData = asWooOrderRawData(order.rawData);
 * if (orderData) { console.log(orderData.billing.email); }
 */
// Validate required and known optional fields before asserting complete API response types.
const strings = (required: string[], optional: string[] = []) => ({
    ...Object.fromEntries(required.map(key => [key, z.string()])),
    ...Object.fromEntries(optional.map(key => [key, z.string().optional()])),
});
const id = z.number().int().nonnegative();
const number = z.number();
const metadata = z.array(z.looseObject({ id, key: z.string(), value: z.unknown() })).optional();
const address = z.looseObject(strings(['first_name', 'last_name'], ['company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country']));
const billing = address.extend({ email: z.string().optional(), phone: z.string().optional() });
const image = z.looseObject({ id, ...strings(['src'], ['date_created', 'date_modified', 'name', 'alt']) });
const lineItem = z.looseObject({
    id, product_id: id, variation_id: id.optional(), quantity: number, price: number,
    ...strings(['name', 'subtotal', 'subtotal_tax', 'total', 'total_tax'], ['tax_class', 'sku']),
    taxes: z.array(z.looseObject({ id, ...strings(['total', 'subtotal']) })).optional(),
    meta_data: metadata,
    image: z.looseObject({ id, src: z.string() }).optional(),
});
const orderSchema = z.looseObject({
    id, ...strings(['status', 'currency', 'date_created', 'date_created_gmt', 'date_modified', 'date_modified_gmt', 'discount_total', 'discount_tax', 'shipping_total', 'shipping_tax', 'cart_tax', 'total', 'total_tax', 'number'], ['version', 'order_key', 'payment_method', 'payment_method_title', 'transaction_id', 'customer_ip_address', 'customer_user_agent', 'created_via', 'customer_note', 'cart_hash']),
    parent_id: id.optional(), customer_id: id, prices_include_tax: z.boolean().optional(), billing, shipping: address, meta_data: metadata,
    ...Object.fromEntries(['date_completed', 'date_completed_gmt', 'date_paid', 'date_paid_gmt'].map(key => [key, z.string().nullable().optional()])),
    line_items: z.array(lineItem),
    tax_lines: z.array(z.looseObject({ id, rate_id: id, compound: z.boolean(), ...strings(['rate_code', 'label', 'tax_total', 'shipping_tax_total']) })).optional(),
    shipping_lines: z.array(z.looseObject({ id, ...strings(['method_title', 'method_id', 'total', 'total_tax'], ['instance_id']) })).optional(),
    fee_lines: z.array(z.looseObject({ id, ...strings(['name', 'amount', 'total', 'total_tax'], ['tax_class', 'tax_status']) })).optional(),
    coupon_lines: z.array(z.looseObject({ id, ...strings(['code', 'discount', 'discount_tax']) })).optional(),
    refunds: z.array(z.looseObject({ id, ...strings(['reason', 'total']) })).optional(),
});
const productSchema = z.looseObject({
    id, ...strings(['name', 'slug', 'date_created', 'date_created_gmt', 'date_modified', 'date_modified_gmt', 'type', 'sku', 'price', 'regular_price'], ['permalink', 'description', 'short_description', 'sale_price', 'price_html', 'external_url', 'button_text', 'tax_class', 'weight', 'shipping_class', 'average_rating', 'purchase_note']),
    status: z.enum(['draft', 'pending', 'private', 'publish']),
    catalog_visibility: z.enum(['visible', 'catalog', 'search', 'hidden']).optional(),
    ...Object.fromEntries(['featured', 'on_sale', 'purchasable', 'virtual', 'downloadable', 'manage_stock', 'backorders_allowed', 'backordered', 'sold_individually', 'shipping_required', 'shipping_taxable', 'reviews_allowed'].map(key => [key, z.boolean().optional()])),
    ...Object.fromEntries(['total_sales', 'shipping_class_id', 'rating_count', 'parent_id', 'menu_order'].map(key => [key, number.optional()])),
    ...Object.fromEntries(['related_ids', 'upsell_ids', 'cross_sell_ids', 'variations', 'grouped_products'].map(key => [key, z.array(id).optional()])),
    date_on_sale_from: z.string().nullable().optional(), date_on_sale_to: z.string().nullable().optional(),
    tax_status: z.enum(['taxable', 'shipping', 'none']).optional(),
    stock_quantity: number.nullable(), stock_status: z.enum(['instock', 'outofstock', 'onbackorder']), backorders: z.enum(['no', 'notify', 'yes']).optional(),
    dimensions: z.looseObject(strings(['length', 'width', 'height'])).optional(),
    categories: z.array(z.looseObject({ id, ...strings(['name', 'slug']) })), tags: z.array(z.looseObject({ id, ...strings(['name', 'slug']) })).optional(),
    images: z.array(image), attributes: z.array(z.looseObject({ id, name: z.string(), position: number, visible: z.boolean(), variation: z.boolean(), options: z.array(z.string()) })).optional(),
    meta_data: metadata,
});
const customerSchema = z.looseObject({
    id, ...strings(['date_created', 'date_created_gmt', 'date_modified', 'date_modified_gmt', 'email', 'first_name', 'last_name'], ['role', 'username', 'avatar_url']),
    billing, shipping: address, is_paying_customer: z.boolean().optional(), meta_data: metadata,
});
const reviewSchema = z.looseObject({
    id, product_id: id, ...strings(['date_created', 'date_created_gmt', 'reviewer', 'reviewer_email', 'review']),
    status: z.enum(['approved', 'hold', 'spam', 'unspam', 'trash', 'untrash']), rating: number, verified: z.boolean(), reviewer_avatar_urls: z.record(z.string(), z.string()).optional(),
});

export function asWooOrderRawData(data: unknown): WooOrderRawData | null {
    return orderSchema.safeParse(data).success ? data as WooOrderRawData : null;
}

export function asWooProductRawData(data: unknown): WooProductRawData | null {
    return productSchema.safeParse(data).success ? data as WooProductRawData : null;
}

export function asWooCustomerRawData(data: unknown): WooCustomerRawData | null {
    return customerSchema.safeParse(data).success ? data as WooCustomerRawData : null;
}

export function asWooReviewRawData(data: unknown): WooReviewRawData | null {
    return reviewSchema.safeParse(data).success ? data as WooReviewRawData : null;
}
