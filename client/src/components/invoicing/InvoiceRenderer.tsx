
import * as React from 'react';
import { clsx } from 'clsx';
import { Image as ImageIcon, Type, Table, DollarSign, User, LayoutTemplate, Heading, FileText } from 'lucide-react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface InvoiceRendererProps {
    layout: any[];
    items: any[];
    data?: any;
    readOnly?: boolean;
    pageMode?: 'single' | 'multi';
}

/**
 * InvoiceRenderer - Renders the invoice template with order data.
 * Shows a clean, print-ready preview (no designer styling).
 */
export function InvoiceRenderer({ layout, items, data, readOnly = true, pageMode = 'single' }: InvoiceRendererProps) {

    // Helper to render content - clean print-ready styling
    const renderContent = (itemConfig: any) => {
        if (!itemConfig) return <div className="p-3 text-red-500 text-sm">Error: Item config missing</div>;

        switch (itemConfig.type) {
            case 'header':
                return (
                    <div className="h-full flex items-center gap-6 py-2">
                        {/* Logo Section - Left */}
                        <div className="w-32 h-full flex items-center justify-start flex-shrink-0">
                            {itemConfig.logo ? (
                                <img src={itemConfig.logo} alt="Logo" className="max-h-full max-w-full object-contain" />
                            ) : (
                                <div className="w-24 h-16 bg-slate-100 rounded flex items-center justify-center">
                                    <ImageIcon size={20} className="text-slate-300" />
                                </div>
                            )}
                        </div>
                        {/* Business Details Section - Right Aligned with Auto-Fit */}
                        <div
                            className="flex-1 text-right text-slate-700 leading-relaxed overflow-hidden"
                            style={{
                                containerType: 'inline-size',
                                fontSize: 'clamp(10px, 2.2cqw, 14px)',
                            }}
                        >
                            {itemConfig.businessDetails ? (
                                <div className="whitespace-pre-wrap break-words">{itemConfig.businessDetails}</div>
                            ) : (
                                <div className="text-slate-400 italic">Business details</div>
                            )}
                        </div>
                    </div>
                );

            case 'order_details':
                const orderNumber = data?.number || data?.order_number || 'N/A';
                const orderDate = data?.date_created
                    ? new Date(data.date_created).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : 'N/A';
                const paymentMethod = data?.payment_method_title || data?.payment_method || 'N/A';
                const shippingMethod = data?.shipping_lines?.[0]?.method_title || data?.shipping_method || 'N/A';

                return (
                    <div className="py-3">
                        <table className="text-sm">
                            <tbody>
                                <tr>
                                    <td className="text-slate-500 pr-8 py-1">Order Number:</td>
                                    <td className="font-medium text-slate-800">{orderNumber}</td>
                                </tr>
                                <tr>
                                    <td className="text-slate-500 pr-8 py-1">Order Date:</td>
                                    <td className="font-medium text-slate-800">{orderDate}</td>
                                </tr>
                                <tr>
                                    <td className="text-slate-500 pr-8 py-1">Payment Method:</td>
                                    <td className="font-medium text-slate-800">{paymentMethod}</td>
                                </tr>
                                <tr>
                                    <td className="text-slate-500 pr-8 py-1">Shipping Method:</td>
                                    <td className="font-medium text-slate-800">{shippingMethod}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                );

            case 'text':
                const style = itemConfig.style || {};
                const isAutoFit = style.autoFit !== false; // Default to true
                let text = itemConfig.content || '';

                // Handlebars-style replacement with data
                if (data) {
                    text = text.replace(/{{(.*?)}}/g, (_: any, key: string) => {
                        const k = key.trim();
                        if (k.includes('.')) {
                            const parts = k.split('.');
                            let value = data;
                            for (const part of parts) {
                                value = value?.[part];
                            }
                            return value || `{{${k}}}`;
                        }
                        return data[k] || `{{${k}}}`;
                    });
                }

                return (
                    <div
                        className={`h-full whitespace-pre-wrap leading-relaxed text-slate-700 ${isAutoFit ? 'overflow-hidden break-words' : ''
                            }`}
                        style={{
                            fontSize: isAutoFit
                                ? `clamp(10px, 2.5cqw, ${style.fontSize || '14px'})`
                                : (style.fontSize || '14px'),
                            fontWeight: style.fontWeight || 'normal',
                            fontStyle: style.fontStyle || 'normal',
                            textAlign: style.textAlign || 'left',
                            containerType: isAutoFit ? 'inline-size' : undefined,
                            wordBreak: isAutoFit ? 'break-word' : undefined,
                        }}
                    >
                        {text}
                    </div>
                );

            case 'image':
                return (
                    <div className="w-full h-full flex items-center justify-center overflow-hidden">
                        {itemConfig.content ? (
                            <img
                                src={itemConfig.content}
                                alt="Invoice"
                                className="max-w-full max-h-full object-contain"
                            />
                        ) : (
                            <div className="w-full h-full bg-slate-50 flex items-center justify-center">
                                <ImageIcon size={24} className="text-slate-300" />
                            </div>
                        )}
                    </div>
                );

            case 'customer_details':
                const billing = data?.billing || {};
                const hasCustomerData = billing.first_name || billing.email;

                return (
                    <div className="py-2">
                        <div className="text-xs uppercase tracking-wider text-slate-400 mb-2 font-semibold">Bill To</div>
                        {hasCustomerData ? (
                            <div className="space-y-0.5 text-sm text-slate-700">
                                {(billing.first_name || billing.last_name) && (
                                    <div className="font-semibold">{billing.first_name} {billing.last_name}</div>
                                )}
                                {billing.company && <div>{billing.company}</div>}
                                {billing.address_1 && <div>{billing.address_1}</div>}
                                {billing.address_2 && <div>{billing.address_2}</div>}
                                {(billing.city || billing.state || billing.postcode) && (
                                    <div>{billing.city}{billing.city && billing.state ? ', ' : ''}{billing.state} {billing.postcode}</div>
                                )}
                                {billing.country && <div>{billing.country}</div>}
                                {billing.email && <div className="text-indigo-600 mt-1">{billing.email}</div>}
                                {billing.phone && <div>{billing.phone}</div>}
                            </div>
                        ) : (
                            <div className="text-slate-400 italic text-sm">Customer details will appear here</div>
                        )}
                    </div>
                );

            case 'order_table':
                const lineItems = data?.line_items || [];
                const hasItems = lineItems.length > 0;
                const hasOrderData = data?.total !== undefined;

                // Helper to format currency
                const formatMoney = (val: any) => {
                    const num = parseFloat(val || 0);
                    return `$${num.toFixed(2)}`;
                };

                // Calculate subtotal
                const orderSubtotal = hasOrderData
                    ? parseFloat(data.total) - parseFloat(data.total_tax || 0) - parseFloat(data.shipping_total || 0)
                    : 0;

                // Helper to safely convert any value to a displayable string
                const safeStringify = (val: any): string => {
                    if (val === null || val === undefined) return '';
                    if (typeof val === 'string') return val;
                    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
                    if (Array.isArray(val)) return val.map(v => safeStringify(v)).join(', ');
                    if (typeof val === 'object') {
                        // Check if it's a simple {key: value} structure - flatten it
                        const entries = Object.entries(val);
                        if (entries.length === 0) return '';
                        return entries.map(([k, v]) => safeStringify(v)).filter(Boolean).join(', ');
                    }
                    return String(val);
                };

                // Helper to extract item metadata
                const getItemMeta = (item: any) => {
                    const meta: { label: string; value: string }[] = [];

                    // Keys to always exclude (internal plugin/system keys)
                    const excludedKeyPatterns = [
                        /^_/,                    // Internal underscore-prefixed keys
                        /^pa_/,                  // Already handled separately for variations
                        /wcpa/i,                 // WCPA plugin internal data
                        /meta_data/i,            // Nested meta references
                        /^reduced_stock/i,       // Stock management internal
                        /label_map/i,            // Internal mappings
                        /droppable/i,            // UI state fields
                    ];

                    const isExcludedKey = (key: string) =>
                        excludedKeyPatterns.some(pattern => pattern.test(key));

                    // Standard fields
                    if (item.sku) meta.push({ label: 'SKU', value: item.sku });

                    // Variation attributes only
                    if (item.variation_id && item.variation_id > 0) {
                        const attrs = item.meta_data?.filter((m: any) =>
                            m.key?.startsWith('pa_') || (m.display_key && !isExcludedKey(m.key || ''))
                        ) || [];
                        attrs.forEach((attr: any) => {
                            const label = attr.display_key || attr.key.replace('pa_', '').replace(/_/g, ' ');
                            const rawValue = attr.display_value || attr.value;
                            const strValue = safeStringify(rawValue);
                            // Only include if value is reasonable length
                            if (strValue.length < 200) {
                                meta.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value: strValue });
                            }
                        });
                    }

                    // Custom meta fields - strict filtering
                    const customMeta = item.meta_data?.filter((m: any) => {
                        const key = m.key || '';
                        // Exclude internal keys
                        if (isExcludedKey(key)) return false;
                        // Must have a display_key to be user-facing
                        if (!m.display_key && !m.display_value) return false;
                        return true;
                    }) || [];

                    customMeta.forEach((m: any) => {
                        const rawValue = m.display_value || m.value;
                        const strValue = safeStringify(rawValue);
                        // Only include if value is reasonable length (not giant internal data)
                        if (strValue.length < 200 && strValue.length > 0) {
                            const label = m.display_key || m.key.replace(/_/g, ' ');
                            meta.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value: strValue });
                        }
                    });

                    return meta;
                };

                return (
                    <div className="py-2" style={{ overflow: 'visible' }}>
                        {hasItems ? (
                            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr className="border-b-2 border-slate-200">
                                        <th className="text-left py-3 font-semibold text-slate-700">Description</th>
                                        <th className="text-center py-3 w-20 font-semibold text-slate-700">Qty</th>
                                        <th className="text-right py-3 w-24 font-semibold text-slate-700">Unit Price</th>
                                        <th className="text-right py-3 w-24 font-semibold text-slate-700">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineItems.map((item: any, i: number) => {
                                        const itemMeta = getItemMeta(item);
                                        const unitPrice = item.quantity > 0
                                            ? (parseFloat(item.total || 0) / item.quantity).toFixed(2)
                                            : '0.00';

                                        return (
                                            <tr
                                                key={i}
                                                className="border-b border-slate-100"
                                                style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                                            >
                                                <td className="py-3">
                                                    <div className="font-medium text-slate-800">{item.name}</div>
                                                    {itemMeta.length > 0 && (
                                                        <div className="mt-1 space-y-0.5">
                                                            {itemMeta.map((meta, j) => (
                                                                <div key={j} className="text-xs text-slate-500">
                                                                    <span className="font-medium">{meta.label}:</span> {meta.value}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-3 text-center text-slate-600">{item.quantity}</td>
                                                <td className="py-3 text-right text-slate-600">${unitPrice}</td>
                                                <td className="py-3 text-right font-medium text-slate-700">${parseFloat(item.total || 0).toFixed(2)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                {/* Integrated Totals Section */}
                                {hasOrderData && (
                                    <tfoot style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                                        <tr>
                                            <td colSpan={4} className="pt-4"></td>
                                        </tr>
                                        <tr>
                                            <td colSpan={2}></td>
                                            <td className="py-1.5 text-right text-slate-600">Subtotal</td>
                                            <td className="py-1.5 text-right text-slate-700">{formatMoney(orderSubtotal)}</td>
                                        </tr>
                                        {data.shipping_total && parseFloat(data.shipping_total) > 0 && (
                                            <tr>
                                                <td colSpan={2}></td>
                                                <td className="py-1.5 text-right text-slate-600">Shipping</td>
                                                <td className="py-1.5 text-right text-slate-700">{formatMoney(data.shipping_total)}</td>
                                            </tr>
                                        )}
                                        <tr>
                                            <td colSpan={2}></td>
                                            <td className="py-1.5 text-right text-slate-600">Tax</td>
                                            <td className="py-1.5 text-right text-slate-700">{formatMoney(data.total_tax)}</td>
                                        </tr>
                                        <tr className="border-t-2 border-slate-300">
                                            <td colSpan={2}></td>
                                            <td className="py-2 text-right font-bold text-slate-800 text-base">Total</td>
                                            <td className="py-2 text-right font-bold text-slate-800 text-base">{formatMoney(data.total)}</td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        ) : (
                            <div className="text-slate-400 italic text-sm py-4 text-center">
                                Order items will appear here
                            </div>
                        )}
                    </div>
                );

            case 'totals':
                const hasData = data?.total !== undefined;
                const formatCurrency = (val: any) => {
                    const num = parseFloat(val || 0);
                    return `$${num.toFixed(2)}`;
                };

                const subtotal = hasData
                    ? parseFloat(data.total) - parseFloat(data.total_tax || 0) - parseFloat(data.shipping_total || 0)
                    : 0;

                return (
                    <div className="py-2">
                        {hasData ? (
                            <table className="w-full text-sm">
                                <tbody>
                                    <tr>
                                        <td className="py-1.5 text-slate-600">Subtotal</td>
                                        <td className="py-1.5 text-right text-slate-700 w-28">{formatCurrency(subtotal)}</td>
                                    </tr>
                                    {data.shipping_total && parseFloat(data.shipping_total) > 0 && (
                                        <tr>
                                            <td className="py-1.5 text-slate-600">Shipping</td>
                                            <td className="py-1.5 text-right text-slate-700">{formatCurrency(data.shipping_total)}</td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td className="py-1.5 text-slate-600">Tax</td>
                                        <td className="py-1.5 text-right text-slate-700">{formatCurrency(data.total_tax)}</td>
                                    </tr>
                                    <tr className="border-t-2 border-slate-300">
                                        <td className="py-2 font-bold text-slate-800 text-base">Total</td>
                                        <td className="py-2 text-right font-bold text-slate-800 text-base">{formatCurrency(data.total)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        ) : (
                            <div className="text-slate-400 italic text-sm">
                                Totals will appear here
                            </div>
                        )}
                    </div>
                );

            case 'footer':
                return (
                    <div className="py-3 text-center text-sm text-slate-500">
                        {itemConfig.content || 'Thank you for your business!'}
                    </div>
                );

            case 'row':
                // Row container - renders children horizontally
                const childItems = (itemConfig.children || []).map((childId: string) =>
                    items.find(i => i.id === childId)
                ).filter(Boolean);

                return (
                    <div className="py-2 flex gap-4" style={{ overflow: 'visible' }}>
                        {childItems.length > 0 ? (
                            childItems.map((child: any) => (
                                <div key={child.id} className="flex-1">
                                    {renderContent(child)}
                                </div>
                            ))
                        ) : (
                            <div className="flex-1 text-slate-400 italic text-sm py-4 text-center">
                                Row container (empty)
                            </div>
                        )}
                    </div>
                );

            default:
                return <div className="p-2 text-slate-500 text-sm">{itemConfig.type}</div>;
        }
    };

    // For multipage mode, calculate approximate page breaks
    const PAGE_HEIGHT_ROWS = 32;

    const getPagedLayout = () => {
        if (pageMode !== 'multi') return [layout];

        const sortedLayout = [...layout].sort((a, b) => a.y - b.y);
        const pages: any[][] = [];
        let currentPage: any[] = [];
        let pageStartY = 0;

        for (const item of sortedLayout) {
            const itemBottom = item.y + item.h;
            const relativeBottom = itemBottom - pageStartY;

            if (relativeBottom > PAGE_HEIGHT_ROWS && currentPage.length > 0) {
                pages.push(currentPage);
                currentPage = [];
                pageStartY = item.y;
            }

            currentPage.push({
                ...item,
                y: item.y - pageStartY
            });
        }

        if (currentPage.length > 0) {
            pages.push(currentPage);
        }

        return pages.length > 0 ? pages : [layout];
    };

    const pages = getPagedLayout();

    return (
        <div className="space-y-8">
            {pages.map((pageLayout, pageIndex) => (
                <div key={pageIndex} className="relative">
                    {/* Page Number Indicator for multipage */}
                    {pageMode === 'multi' && pages.length > 1 && (
                        <div className="absolute -top-6 right-0 text-xs text-slate-400 font-medium">
                            Page {pageIndex + 1} of {pages.length}
                        </div>
                    )}

                    {/* Paper Container */}
                    <div
                        className="max-w-[210mm] mx-auto bg-white shadow-2xl rounded-sm relative ring-1 ring-slate-200/50"
                        style={{ minHeight: pageMode === 'multi' ? '297mm' : 'auto' }}
                    >
                        {/* Grid Layout */}
                        {/* @ts-ignore - ResponsiveGridLayout has prop type mismatch */}
                        <ResponsiveGridLayout
                            className="layout"
                            layouts={{ lg: pageLayout }}
                            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                            rowHeight={30}
                            // @ts-ignore - width prop type mismatch
                            width={794}
                            isDraggable={!readOnly}
                            isResizable={!readOnly}
                            margin={[16, 8]}
                        >
                            {pageLayout.map((l: any) => {
                                const itemConfig = items.find(i => i.id === l.i);

                                // Hide headers on pages after the first
                                if (pageMode === 'multi' && pageIndex > 0 && itemConfig?.type === 'header') {
                                    return <div key={l.i} className="hidden"></div>;
                                }

                                // Hide footers on pages before the last
                                if (pageMode === 'multi' && pageIndex < pages.length - 1 && itemConfig?.type === 'footer') {
                                    return <div key={l.i} className="hidden"></div>;
                                }

                                // Allow order_table to overflow its grid cell so totals don't get clipped
                                const isOrderTable = itemConfig?.type === 'order_table';

                                return (
                                    <div
                                        key={l.i}
                                        className="bg-white"
                                        style={isOrderTable ? { overflow: 'visible', zIndex: 10 } : undefined}
                                    >
                                        {itemConfig && renderContent(itemConfig)}
                                    </div>
                                );
                            })}
                        </ResponsiveGridLayout>
                    </div>

                    {/* Page Break Indicator */}
                    {pageMode === 'multi' && pageIndex < pages.length - 1 && (
                        <div className="flex items-center justify-center py-4">
                            <div className="flex-1 border-t-2 border-dashed border-slate-300"></div>
                            <span className="px-4 text-xs text-slate-400 font-medium uppercase tracking-wide">Page Break</span>
                            <div className="flex-1 border-t-2 border-dashed border-slate-300"></div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
