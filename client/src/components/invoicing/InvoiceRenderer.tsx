
import { Image as ImageIcon } from 'lucide-react';
import {
    formatInvoiceCurrency,
    mergeInvoiceSettings,
    resolveInvoiceTemplateString
} from '../../../../packages/overseek-core/src/invoiceRenderModel';
import { getInvoiceItemMeta } from '../../../../packages/overseek-core/src/invoiceItemUtils';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

type InvoiceItemType =
    | 'header'
    | 'text'
    | 'image'
    | 'order_details'
    | 'customer_details'
    | 'order_table'
    | 'totals'
    | 'payment_block'
    | 'footer'
    | 'row';

interface InvoiceItemStyle {
    fontSize?: string;
    fontWeight?: string;
    fontStyle?: string;
    textAlign?: 'left' | 'center' | 'right';
    autoFit?: boolean;
}

interface InvoiceItem {
    id: string;
    type: InvoiceItemType;
    content?: string;
    logo?: string;
    businessDetails?: string;
    style?: InvoiceItemStyle;
    children?: string[];
}

interface InvoiceLayoutItem {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    [key: string]: unknown;
}

interface BillingData {
    first_name?: string;
    last_name?: string;
    email?: string;
    company?: string;
    address_1?: string;
    address_2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    phone?: string;
}

interface ShippingLineData {
    method_title?: string;
    methodTitle?: string;
}

interface InvoiceLineItemData {
    name?: string;
    quantity?: number;
    total?: string | number;
    [key: string]: unknown;
}

interface InvoiceOrderData {
    number?: string | number;
    order_number?: string | number;
    date_created?: string;
    payment_method_title?: string;
    payment_method?: string;
    shipping_lines?: ShippingLineData[];
    shipping_method?: string;
    billing?: BillingData;
    line_items?: InvoiceLineItemData[];
    total?: string | number;
    total_tax?: string | number;
    shipping_total?: string | number;
    discount_total?: string | number;
    currency?: string;
    [key: string]: unknown;
}

const toNumber = (val: unknown) => {
    const parsed = Number(val ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const dedupeMetaEntries = (item: InvoiceLineItemData) => {
    const stripUrls = (value: string) => {
        const withoutUrls = value.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '');
        return withoutUrls.replace(/\s{2,}/g, ' ').replace(/\s+\|\s+/g, ' | ').trim();
    };

    const truncateMetaValue = (value: string) => {
        const compact = value.replace(/\s+/g, ' ').trim();
        if (compact.length <= 140) return compact;

        if (/^https?:\/\//i.test(compact)) {
            try {
                const url = new URL(compact);
                const shortenedPath = url.pathname.length > 28
                    ? `${url.pathname.slice(0, 18)}...${url.pathname.slice(-8)}`
                    : url.pathname;
                return `${url.origin}${shortenedPath}`;
            } catch {
                // Fall through to generic truncation
            }
        }

        return `${compact.slice(0, 110)}...${compact.slice(-24)}`;
    };

    const seen = new Set<string>();
    return getInvoiceItemMeta(item)
        .map((meta) => {
            const label = String(meta.label || '').trim();
            const rawValue = String(meta.value || '').trim();
            if (!label || !rawValue) return null;

            const valueParts = rawValue
                .split('|')
                .map((part) => part.trim())
                .filter(Boolean);
            const uniqueParts: string[] = [];
            const localSeen = new Set<string>();
            for (const part of valueParts) {
                const key = part.toLowerCase();
                if (localSeen.has(key)) continue;
                localSeen.add(key);
                uniqueParts.push(part);
            }

            const sanitizedValue = stripUrls(uniqueParts.length > 0 ? uniqueParts.join(' | ') : rawValue);
            if (!sanitizedValue) return null;
            const normalizedValue = truncateMetaValue(sanitizedValue);
            const globalKey = `${label.toLowerCase()}::${normalizedValue.toLowerCase()}`;
            if (seen.has(globalKey)) return null;
            seen.add(globalKey);
            return { label, value: normalizedValue };
        })
        .filter((meta): meta is { label: string; value: string } => Boolean(meta));
};

interface InvoiceRendererProps {
    layout: InvoiceLayoutItem[];
    items: InvoiceItem[];
    data?: InvoiceOrderData;
    settings?: Record<string, unknown>;
    readOnly?: boolean;
    pageMode?: 'single' | 'multi';
}

/**
 * InvoiceRenderer - Renders the invoice template with order data.
 * Shows a clean, print-ready preview (no designer styling).
 */
export function InvoiceRenderer({ layout, items, data, settings, readOnly = true, pageMode = 'single' }: InvoiceRendererProps) {
    const mergedSettings = mergeInvoiceSettings(settings || {});

    // Helper to render content - clean print-ready styling
    const renderContent = (itemConfig: InvoiceItem) => {
        if (!itemConfig) return <div className="p-3 text-red-500 text-sm">Error: Item config missing</div>;

        switch (itemConfig.type) {
            case 'header':
                return (
                    <div className="h-full flex items-start gap-6 py-1">
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
                            className="flex-1 h-full text-right text-black"
                            style={{
                                containerType: 'size',
                                fontSize: 'clamp(8px, min(2.2cqw, 3.2cqh), 14px)',
                                lineHeight: 1.35,
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

            case 'order_details': {
                const orderNumber = data?.number || data?.order_number || 'N/A';
                const orderDate = data?.date_created
                    ? new Date(data.date_created).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : 'N/A';
                const paymentMethod = data?.payment_method_title || data?.payment_method || 'N/A';
                const shippingMethod =
                    data?.shipping_lines?.[0]?.method_title
                    || data?.shipping_lines?.[0]?.methodTitle
                    || data?.shipping_method
                    || 'N/A';

                return (
                    <div className="py-3">
                        <table className="w-full text-sm table-fixed">
                            <tbody>
                                <tr>
                                    <td className="text-black pr-4 py-1 whitespace-nowrap w-40">Order Number:</td>
                                    <td className="font-semibold text-black">{orderNumber}</td>
                                </tr>
                                <tr>
                                    <td className="text-black pr-4 py-1 whitespace-nowrap w-40">Order Date:</td>
                                    <td className="font-semibold text-black">{orderDate}</td>
                                </tr>
                                <tr>
                                    <td className="text-black pr-4 py-1 whitespace-nowrap w-40">Payment Method:</td>
                                    <td className="font-semibold text-black break-words">{paymentMethod}</td>
                                </tr>
                                <tr>
                                    <td className="text-black pr-4 py-1 whitespace-nowrap w-40">Shipping Method:</td>
                                    <td className="font-semibold text-black break-words">{shippingMethod}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                );
            }

            case 'text': {
                const style = itemConfig.style || {};
                const isAutoFit = style.autoFit !== false; // Default to true
                let text = itemConfig.content || '';

                // Handlebars-style replacement with data
                if (data) {
                    text = resolveInvoiceTemplateString(text, data);
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
            }

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

            case 'customer_details': {
                const billing = data?.billing || {};
                const hasCustomerData = billing.first_name || billing.email;

                return (
                    <div className="py-2">
                        <div className="text-xs uppercase tracking-wider text-black mb-2 font-semibold">Bill To</div>
                        {hasCustomerData ? (
                            <div className="space-y-0.5 text-sm text-black">
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
                                {billing.email && <div className="text-blue-700 mt-1">{billing.email}</div>}
                                {billing.phone && <div>{billing.phone}</div>}
                            </div>
                        ) : (
                            <div className="text-slate-400 italic text-sm">Customer details will appear here</div>
                        )}
                    </div>
                );
            }

            case 'order_table': {
                const lineItems = data?.line_items || [];
                const hasItems = lineItems.length > 0;
                const hasOrderData = data?.total !== undefined;

                // Helper to format currency using order's actual currency
                const formatMoney = (val: unknown) => {
                    return formatInvoiceCurrency(toNumber(val), mergedSettings, data?.currency || mergedSettings.locale.currency || 'USD');
                };

                // Calculate subtotal
                const orderSubtotal = hasOrderData
                    ? toNumber(data.total) - toNumber(data.total_tax) - toNumber(data.shipping_total)
                    : 0;

                // Helper to extract item metadata (delegated to shared utility)

                return (
                    <div className="py-2" style={{ overflow: 'visible' }}>
                        {hasItems ? (
                            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr className="border-b-2 border-slate-200">
                                        <th className="text-left py-3 font-semibold text-black">Description</th>
                                        <th className="text-center py-3 w-20 font-semibold text-black">Qty</th>
                                        <th className="text-right py-3 w-24 font-semibold text-black">Unit Price</th>
                                        <th className="text-right py-3 w-24 font-semibold text-black">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineItems.map((item, i: number) => {
                                        const itemMeta = dedupeMetaEntries(item);
                                        const quantity = toNumber(item.quantity);
                                        const lineTotal = toNumber(item.total);
                                        const unitPrice = quantity > 0
                                            ? (lineTotal / quantity).toFixed(2)
                                            : '0.00';

                                        return (
                                            <tr
                                                key={i}
                                                className="border-b border-slate-100"
                                                style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                                            >
                                                <td className="py-3">
                                                    <div className="font-semibold text-black">{item.name}</div>
                                                    {itemMeta.length > 0 && (
                                                        <div className="mt-1 space-y-0.5">
                                                            {itemMeta.map((meta, j) => (
                                                                <div key={j} className="text-xs text-black">
                                                                    <span className="font-medium">{meta.label}:</span> {meta.value}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-3 text-center text-black">{quantity}</td>
                                                <td className="py-3 text-right text-black">${unitPrice}</td>
                                                <td className="py-3 text-right font-semibold text-black">${lineTotal.toFixed(2)}</td>
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
                                            <td className="py-1.5 text-right text-black">Subtotal</td>
                                            <td className="py-1.5 text-right text-black">{formatMoney(orderSubtotal)}</td>
                                        </tr>
                                        {toNumber(data.shipping_total) > 0 && (
                                            <tr>
                                                <td colSpan={2}></td>
                                                <td className="py-1.5 text-right text-black">Shipping</td>
                                                <td className="py-1.5 text-right text-black">{formatMoney(data.shipping_total)}</td>
                                            </tr>
                                        )}
                                        {toNumber(data.discount_total) > 0 && (
                                            <tr>
                                                <td colSpan={2}></td>
                                                <td className="py-1.5 text-right text-emerald-600">Discount</td>
                                                <td className="py-1.5 text-right text-emerald-600">-{formatMoney(data.discount_total)}</td>
                                            </tr>
                                        )}
                                        <tr>
                                            <td colSpan={2}></td>
                                            <td className="py-1.5 text-right text-black">Tax</td>
                                            <td className="py-1.5 text-right text-black">{formatMoney(data.total_tax)}</td>
                                        </tr>
                                        <tr className="border-t-2 border-slate-300">
                                            <td colSpan={2}></td>
                                            <td className="py-2 text-right font-bold text-black text-base">Total</td>
                                            <td className="py-2 text-right font-bold text-black text-base">{formatMoney(data.total)}</td>
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
            }

            case 'totals': {
                const hasData = data?.total !== undefined;
                const formatCurrency = (val: unknown) => {
                    return formatInvoiceCurrency(toNumber(val), mergedSettings, data?.currency || mergedSettings.locale.currency || 'USD');
                };

                const subtotal = hasData
                    ? toNumber(data.total) - toNumber(data.total_tax) - toNumber(data.shipping_total)
                    : 0;

                return (
                    <div className="py-2">
                        {hasData ? (
                            <table className="w-full text-sm">
                                <tbody>
                                    <tr>
                                        <td className="py-1.5 text-black">Subtotal</td>
                                        <td className="py-1.5 text-right text-black w-28">{formatCurrency(subtotal)}</td>
                                    </tr>
                                    {toNumber(data.shipping_total) > 0 && (
                                        <tr>
                                            <td className="py-1.5 text-black">Shipping</td>
                                            <td className="py-1.5 text-right text-black">{formatCurrency(data.shipping_total)}</td>
                                        </tr>
                                    )}
                                    {toNumber(data.discount_total) > 0 && (
                                        <tr>
                                            <td className="py-1.5 text-black">Discount</td>
                                            <td className="py-1.5 text-right text-black">-{formatCurrency(data.discount_total)}</td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td className="py-1.5 text-black">Tax</td>
                                        <td className="py-1.5 text-right text-black">{formatCurrency(data.total_tax)}</td>
                                    </tr>
                                    <tr className="border-t-2 border-slate-300">
                                        <td className="py-2 font-bold text-black text-base">Total</td>
                                        <td className="py-2 text-right font-bold text-black text-base">{formatCurrency(data.total)}</td>
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
            }

            case 'payment_block':
                return (
                    <div className="py-2 border border-cyan-200 rounded-lg bg-cyan-50/40 p-3">
                        <div className="text-xs uppercase tracking-wider text-black font-semibold mb-2">Payment</div>
                        {(itemConfig.content || mergedSettings.payment.payNowUrl) ? (
                            <div className="space-y-2">
                                <div className="w-16 h-16 rounded-md border border-cyan-300 bg-white grid grid-cols-4 gap-0.5 p-1">
                                    {Array.from({ length: 16 }).map((_, idx) => (
                                        <div key={idx} className={`${idx % 3 === 0 ? 'bg-cyan-700' : 'bg-cyan-100'} rounded-xs`} />
                                    ))}
                                </div>
                                <div className="text-xs text-black">Scan to pay</div>
                            </div>
                        ) : (
                            <div className="text-slate-400 italic text-sm">Set a Pay URL in settings or this block.</div>
                        )}
                    </div>
                );

            case 'footer':
                return (
                    <div className="py-3 text-center text-sm text-black bg-white">
                        <div>{itemConfig.content || 'Thank you for your business!'}</div>
                        {mergedSettings.compliance.legalFooter && (
                            <div className="mt-1 text-xs text-black whitespace-pre-wrap">{mergedSettings.compliance.legalFooter}</div>
                        )}
                    </div>
                );

            case 'row': {
                // Row container - renders children horizontally
                const childItems = (itemConfig.children || []).map((childId: string) =>
                    items.find(i => i.id === childId)
                ).filter((child): child is InvoiceItem => Boolean(child));

                return (
                    <div className="py-2 flex gap-4" style={{ overflow: 'visible' }}>
                        {childItems.length > 0 ? (
                            childItems.map((child) => (
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
            }

            default:
                return <div className="p-2 text-slate-500 text-sm">{itemConfig.type}</div>;
        }
    };

    // For multipage mode, calculate approximate page breaks
    const PAGE_HEIGHT_ROWS = 32;

    const getPagedLayout = () => {
        if (pageMode !== 'multi') return [layout];

        const sortedLayout = [...layout].sort((a, b) => a.y - b.y);
        const pages: InvoiceLayoutItem[][] = [];
        let currentPage: InvoiceLayoutItem[] = [];
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

    const getAutoExpandedReadOnlyLayout = (): InvoiceLayoutItem[] => {
        const lineItems = data?.line_items || [];
        if (lineItems.length === 0) return layout;

        const orderTableItem = items.find((item) => item.type === 'order_table');
        if (!orderTableItem) return layout;

        const orderTableLayout = layout.find((l) => l.i === orderTableItem.id);
        if (!orderTableLayout) return layout;

        const hasOrderData = data?.total !== undefined;

        // Approximate content height for the table block so export can span pages.
        // This is intentionally conservative: only order_table is allowed to grow.
        const headerPx = 44;
        const baseRowPx = 38;
        const metaRowPx = 14;
        const totalsPx = hasOrderData ? 96 : 0;
        const verticalPaddingPx = 14;

        const rowsPx = lineItems.reduce((sum, item) => {
            const metaCount = getInvoiceItemMeta(item).length;
            return sum + baseRowPx + (metaCount * metaRowPx);
        }, 0);

        const estimatedPx = headerPx + rowsPx + totalsPx + verticalPaddingPx;

        // Keep in sync with grid rowHeight (30) and use a tight safety margin.
        const estimatedRows = Math.max(orderTableLayout.h, Math.ceil((estimatedPx + 6) / 30));

        const growthRows = Math.max(0, estimatedRows - orderTableLayout.h);
        const originalTableBottom = orderTableLayout.y + orderTableLayout.h;
        const shiftedLayout = layout.map((entry) => {
            if (entry.i === orderTableLayout.i) {
                return { ...entry, h: estimatedRows };
            }

            // Only shift blocks that are below the original table bottom.
            // This avoids creating large artificial gaps/page overflows.
            if (growthRows > 0 && entry.y >= originalTableBottom) {
                return { ...entry, y: entry.y + growthRows };
            }

            return entry;
        });

        const footerItem = items.find((item) => item.type === 'footer');
        if (!footerItem?.id) return shiftedLayout;

        const footerLayout = shiftedLayout.find((entry) => entry.i === footerItem.id);
        if (!footerLayout) return shiftedLayout;

        const maxBottomWithoutFooter = shiftedLayout
            .filter((entry) => entry.i !== footerLayout.i)
            .reduce((max, entry) => Math.max(max, entry.y + entry.h), 0);

        return shiftedLayout.map((entry) => {
            if (entry.i !== footerLayout.i) return entry;
            return {
                ...entry,
                y: Math.max(entry.y, maxBottomWithoutFooter),
            };
        });
    };

    // Read-only mode should preserve the designer's exact placement/size.
    // Use react-grid-layout in static mode so PDF export matches editor geometry.
    if (readOnly) {
        const expandedLayout = getAutoExpandedReadOnlyLayout();
        const sortedLayout = [...expandedLayout].sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const maxRowBottom = sortedLayout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
        const pageHeightPx = Math.max(1, maxRowBottom) * 30;

        return (
            <div
                className="max-w-[210mm] mx-auto bg-white shadow-2xl rounded-sm ring-1 ring-slate-200/50"
                style={{ minHeight: pageMode === 'multi' ? '297mm' : 'auto' }}
            >
                <div style={{ minHeight: `${pageHeightPx}px` }}>
                    <ResponsiveGridLayout
                        className="layout"
                        layouts={{ lg: sortedLayout }}
                        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                        rowHeight={30}
                        // @ts-expect-error - width prop type mismatch
                        width={794}
                        isDraggable={false}
                        isResizable={false}
                        compactType={null}
                        preventCollision={true}
                        margin={[16, 8]}
                        useCSSTransforms={false}
                        isBounded={true}
                        resizeHandles={[]}
                    >
                        {sortedLayout.map((l) => {
                            const itemConfig = items.find(i => i.id === l.i);
                            if (!itemConfig) {
                                return <div key={l.i} className="hidden" />;
                            }

                            return (
                                <div
                                    key={l.i}
                                    className="bg-white overflow-hidden min-w-0"
                                >
                                    {renderContent(itemConfig)}
                                </div>
                            );
                        })}
                    </ResponsiveGridLayout>
                </div>
            </div>
        );
    }

    // Designer mode uses grid layout for drag/drop
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
                        <ResponsiveGridLayout
                            className="layout"
                            layouts={{ lg: pageLayout }}
                            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                            rowHeight={30}
                            // @ts-expect-error - width prop type mismatch
                            width={794}
                            isDraggable={true}
                            isResizable={true}
                            margin={[16, 8]}
                        >
                            {pageLayout.map((l: InvoiceLayoutItem) => {
                                const itemConfig = items.find(i => i.id === l.i);

                                // Hide headers on pages after the first
                                if (pageMode === 'multi' && pageIndex > 0 && itemConfig?.type === 'header') {
                                    return <div key={l.i} className="hidden"></div>;
                                }

                                // Hide footers on pages before the last
                                if (pageMode === 'multi' && pageIndex < pages.length - 1 && itemConfig?.type === 'footer') {
                                    return <div key={l.i} className="hidden"></div>;
                                }

                                return (
                                    <div
                                        key={l.i}
                                        className="bg-white"
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
