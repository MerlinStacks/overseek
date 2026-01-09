
import * as React from 'react';
import { clsx } from 'clsx';
// React Grid Layout for static display? Or just absolute positioning/grid css.
// Since we used RGL in designer, we should probably use a static RGL layout or map to styles.
// For robust PDF generation, mapping to standard HTML/CSS grid is better than relying on JS layout lib if possible,
// but for 1:1 fidelity, using the same layout engine (RGL with isDraggable=false) is safest.

import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface InvoiceRendererProps {
    layout: any[]; // The Grid Layout
    items: any[];  // The content configuration
    data?: any;    // The Order Data
    readOnly?: boolean;
}

export function InvoiceRenderer({ layout, items, data, readOnly = true }: InvoiceRendererProps) {

    // Helper to render content based on data
    const renderContent = (itemConfig: any) => {
        switch (itemConfig.type) {
            case 'text':
                // Simple handlebars-style replacement
                let text = itemConfig.content || '';
                if (data) {
                    text = text.replace(/{{(.*?)}}/g, (_: any, key: string) => {
                        const k = key.trim();
                        return data[k] || `{{${k}}}`;
                    });
                }
                return <div className="p-2 h-full text-sm">{text}</div>;

            case 'image':
                return <div className="h-full w-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">Image</div>;

            case 'order_table':
                return (
                    <div className="h-full w-full overflow-hidden p-2">
                        <table className="min-w-full text-xs text-left">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="py-1 px-2">Item</th>
                                    <th className="py-1 px-2 text-right">Qty</th>
                                    <th className="py-1 px-2 text-right">Price</th>
                                    <th className="py-1 px-2 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data?.line_items?.map((item: any, i: number) => (
                                    <tr key={i} className="border-b last:border-0">
                                        <td className="py-1 px-2">{item.name}</td>
                                        <td className="py-1 px-2 text-right">{item.quantity}</td>
                                        <td className="py-1 px-2 text-right">${item.price}</td>
                                        <td className="py-1 px-2 text-right">${item.total}</td>
                                    </tr>
                                )) || (
                                        <tr>
                                            <td className="py-1 px-2">Example Product</td>
                                            <td className="py-1 px-2 text-right">1</td>
                                            <td className="py-1 px-2 text-right">$50.00</td>
                                            <td className="py-1 px-2 text-right">$50.00</td>
                                        </tr>
                                    )}
                            </tbody>
                        </table>
                    </div>
                );

            case 'totals':
                return (
                    <div className="h-full w-full p-2 flex flex-col justify-end items-end text-sm">
                        <div className="flex gap-4">
                            <span className="text-gray-500">Subtotal:</span>
                            <span>${data?.subtotal || '0.00'}</span>
                        </div>
                        <div className="flex gap-4">
                            <span className="text-gray-500">Tax:</span>
                            <span>${data?.total_tax || '0.00'}</span>
                        </div>
                        <div className="flex gap-4 font-bold border-t mt-1 pt-1">
                            <span>Total:</span>
                            <span>${data?.total || '0.00'}</span>
                        </div>
                    </div>
                );

            default:
                return <div className="p-2 text-xs text-red-400">Unknown Item</div>;
        }
    };

    return (
        <div className="bg-white" style={{ minHeight: '297mm', width: '210mm' }}>
            <ResponsiveGridLayout
                className="layout"
                layouts={{ lg: layout }}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={30}
                // @ts-ignore - WidthProvider types match mismatch
                width={794} // approx A4 width in px at 96dpi
                isDraggable={!readOnly}
                isResizable={!readOnly}
                margin={[0, 0]} // Tight packing for print?
            >
                {layout.map(l => {
                    const itemConfig = items.find(i => i.id === l.i);
                    return (
                        <div key={l.i} className={clsx("bg-white", { "border border-dashed border-gray-200": !readOnly })}>
                            {itemConfig && renderContent(itemConfig)}
                        </div>
                    );
                })}
            </ResponsiveGridLayout>
        </div>
    );
}
