
import * as React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import {
    buildInvoiceNumber,
    formatInvoiceCurrency,
    formatInvoiceDate,
    mergeInvoiceSettings
} from '../../../../packages/overseek-core/src/invoiceRenderModel';
import { getItemMeta, resolveHandlebars } from '../../utils/invoiceItemUtils';
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
    const invoiceNumber = buildInvoiceNumber(mergedSettings);
    const invoiceIssueDate = new Date();
    const invoiceDueDate = new Date(invoiceIssueDate);
    invoiceDueDate.setDate(invoiceDueDate.getDate() + Number(mergedSettings.compliance.paymentTermsDays || 14));

    // Helper to render content - clean print-ready styling
    const renderContent = (itemConfig: InvoiceItem) => {
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

            case 'order_details': {
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
                                    <td className="text-slate-500 pr-8 py-1">Invoice Number:</td>
                                    <td className="font-medium text-slate-800">{invoiceNumber}</td>
                                </tr>
                                <tr>
                                    <td className="text-slate-500 pr-8 py-1">Invoice Date:</td>
                                    <td className="font-medium text-slate-800">{formatInvoiceDate(invoiceIssueDate, mergedSettings)}</td>
                                </tr>
                                <tr>
                                    <td className="text-slate-500 pr-8 py-1">Due Date:</td>
                                    <td className="font-medium text-slate-800">{formatInvoiceDate(invoiceDueDate, mergedSettings)}</td>
                                </tr>
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
            }

            case 'text': {
                const style = itemConfig.style || {};
                const isAutoFit = style.autoFit !== false; // Default to true
                let text = itemConfig.content || '';

                // Handlebars-style replacement with data
                if (data) {
                    text = resolveHandlebars(text, data);
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
                                        <th className="text-left py-3 font-semibold text-slate-700">Description</th>
                                        <th className="text-center py-3 w-20 font-semibold text-slate-700">Qty</th>
                                        <th className="text-right py-3 w-24 font-semibold text-slate-700">Unit Price</th>
                                        <th className="text-right py-3 w-24 font-semibold text-slate-700">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lineItems.map((item, i: number) => {
                                        const itemMeta = getItemMeta(item);
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
                                                <td className="py-3 text-center text-slate-600">{quantity}</td>
                                                <td className="py-3 text-right text-slate-600">${unitPrice}</td>
                                                <td className="py-3 text-right font-medium text-slate-700">${lineTotal.toFixed(2)}</td>
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
                                        {toNumber(data.shipping_total) > 0 && (
                                            <tr>
                                                <td colSpan={2}></td>
                                                <td className="py-1.5 text-right text-slate-600">Shipping</td>
                                                <td className="py-1.5 text-right text-slate-700">{formatMoney(data.shipping_total)}</td>
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
                                        <td className="py-1.5 text-slate-600">Subtotal</td>
                                        <td className="py-1.5 text-right text-slate-700 w-28">{formatCurrency(subtotal)}</td>
                                    </tr>
                                    {toNumber(data.shipping_total) > 0 && (
                                        <tr>
                                            <td className="py-1.5 text-slate-600">Shipping</td>
                                            <td className="py-1.5 text-right text-slate-700">{formatCurrency(data.shipping_total)}</td>
                                        </tr>
                                    )}
                                    {toNumber(data.discount_total) > 0 && (
                                        <tr>
                                            <td className="py-1.5 text-emerald-600">Discount</td>
                                            <td className="py-1.5 text-right text-emerald-600">-{formatCurrency(data.discount_total)}</td>
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
            }

            case 'payment_block':
                return (
                    <div className="py-2 border border-cyan-200 rounded-lg bg-cyan-50/40 p-3">
                        <div className="text-xs uppercase tracking-wider text-cyan-700 font-semibold mb-2">Payment</div>
                        {(itemConfig.content || mergedSettings.payment.payNowUrl) ? (
                            <div className="space-y-2">
                                <div className="text-sm text-cyan-700 break-all">
                                    {mergedSettings.payment.payNowLabel || 'Pay now'}: {itemConfig.content || mergedSettings.payment.payNowUrl}
                                </div>
                                <div className="w-16 h-16 rounded-md border border-cyan-300 bg-white grid grid-cols-4 gap-0.5 p-1">
                                    {Array.from({ length: 16 }).map((_, idx) => (
                                        <div key={idx} className={`${idx % 3 === 0 ? 'bg-cyan-700' : 'bg-cyan-100'} rounded-xs`} />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="text-slate-400 italic text-sm">Set a Pay URL in settings or this block.</div>
                        )}
                    </div>
                );

            case 'footer':
                return (
                    <div className="py-3 text-center text-sm text-slate-500 bg-white relative z-20">
                        <div>{itemConfig.content || 'Thank you for your business!'}</div>
                        {mergedSettings.compliance.legalFooter && (
                            <div className="mt-1 text-xs text-slate-400 whitespace-pre-wrap">{mergedSettings.compliance.legalFooter}</div>
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

    // For readOnly (preview) mode, use flow-based layout to prevent overlap
    // Grid layout doesn't auto-size cells, causing content overflow issues
    if (readOnly) {
        // Sort items by Y position to render in visual order
        const sortedLayout = [...layout].sort((a, b) => a.y - b.y);

        // Separate footer items to render at the end
        const footerItems: Array<{ layout: InvoiceLayoutItem; config: InvoiceItem }> = [];
        const contentItems: Array<{ layout: InvoiceLayoutItem; config: InvoiceItem }> = [];

        sortedLayout.forEach(l => {
            const itemConfig = items.find(i => i.id === l.i);
            if (!itemConfig) return;
            if (itemConfig.type === 'footer') {
                footerItems.push({ layout: l, config: itemConfig });
            } else {
                contentItems.push({ layout: l, config: itemConfig });
            }
        });

        return (
            <div
                className="max-w-[210mm] mx-auto bg-white shadow-2xl rounded-sm ring-1 ring-slate-200/50 p-4"
                style={{ minHeight: pageMode === 'multi' ? '297mm' : 'auto' }}
            >
                {/* Content items in flow layout */}
                {contentItems.map(({ layout: l, config: itemConfig }) => (
                    <div key={l.i} className="mb-2">
                        {renderContent(itemConfig)}
                    </div>
                ))}

                {/* Footer items at the end */}
                {footerItems.map(({ layout: l, config: itemConfig }) => (
                    <div key={l.i} className="mt-4 pt-4 border-t border-slate-200">
                        {renderContent(itemConfig)}
                    </div>
                ))}
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
