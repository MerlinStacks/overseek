/**
 * WooCommerce Data Types
 * 
 * Type definitions for WooCommerce rawData JSON fields stored in Prisma.
 * These replace `as any` casts throughout the codebase for better type safety.
 */

// ============================================
// ORDER TYPES
// ============================================

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
    meta_data?: Array<{ id: number; key: string; value: string }>;
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

// ============================================
// PRODUCT TYPES
// ============================================

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

// ============================================
// CUSTOMER TYPES
// ============================================

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

// ============================================
// REVIEW TYPES
// ============================================

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

// ============================================
// UTILITY TYPE GUARD FUNCTIONS
// ============================================

/**
 * Type guard - use when accessing rawData from Prisma models
 * @example
 * const orderData = asWooOrderRawData(order.rawData);
 * if (orderData) { console.log(orderData.billing.email); }
 */
export function asWooOrderRawData(data: unknown): WooOrderRawData | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'number' && typeof d.total === 'string' && d.billing) {
        return data as WooOrderRawData;
    }
    return null;
}

export function asWooProductRawData(data: unknown): WooProductRawData | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'number' && typeof d.name === 'string') {
        return data as WooProductRawData;
    }
    return null;
}

export function asWooCustomerRawData(data: unknown): WooCustomerRawData | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'number' && typeof d.email === 'string') {
        return data as WooCustomerRawData;
    }
    return null;
}

export function asWooReviewRawData(data: unknown): WooReviewRawData | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'number' && typeof d.product_id === 'number') {
        return data as WooReviewRawData;
    }
    return null;
}
