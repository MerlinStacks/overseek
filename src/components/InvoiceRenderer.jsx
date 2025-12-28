import React from 'react';

// Default preview data to fall back on if no real data is provided
export const PREVIEW_DATA = {
    line_items: [
        { id: 1, name: 'Web Design Service', quantity: 1, subtotal: '1500.00' },
        { id: 2, name: 'Hosting (1 Year)', quantity: 1, subtotal: '200.00' },
    ],
    total: '1700.00',
    currency: '$',
    order_number: '1001',
    order_date: '2024-10-24',
    payment_method: 'Credit Card (Visa)',
    billing: { name: 'John Doe', address: '123 Main St', city: 'Sydney', state: 'NSW', zip: '2000', country: 'Australia', email: 'john@example.com', phone: '555-1234' },
    shipping: { name: 'Jane Doe', address: '456 Tech Park', city: 'Melbourne', state: 'VIC', zip: '3000', country: 'Australia' }
};

export const InvoiceBlockRenderer = ({ block, data = PREVIEW_DATA }) => {
    const style = {
        textAlign: block.align || 'left',
        fontSize: block.fontSize || 14,
        fontFamily: block.fontFamily || 'inherit'
    };

    // Header
    if (block.type === 'header') return <div style={{ ...style, fontWeight: 'bold' }}>{block.content}</div>;

    // Text
    if (block.type === 'text') return <div style={{ ...style, whiteSpace: 'pre-wrap' }}>{block.content || 'Edit text...'}</div>;

    // Logo
    if (block.type === 'logo') return (
        <div style={style}>
            {block.src ? <img src={block.src} alt="Logo" style={{ maxWidth: '100%' }} /> :
                <div style={{ background: '#f1f5f9', padding: '20px', textAlign: 'center', color: '#94a3b8' }}>LOGO</div>}
        </div>
    );

    // Spacer
    if (block.type === 'spacer') return <div style={{ height: block.height || 20 }}></div>;

    // Addresses
    if (block.type === 'billing_address' || block.type === 'shipping_address') {
        // Map real order data structure to flat structure if needed, or assume data matches
        // Real order data from WooCommerce usually has billing: { first_name, last_name, address_1, ... }

        let displayData = {};
        if (data.billing && data.billing.first_name) {
            // Real WooCommerce Data
            const source = block.type === 'billing_address' ? data.billing : (data.shipping || data.billing);
            displayData = {
                name: `${source.first_name} ${source.last_name}`,
                address: `${source.address_1} ${source.address_2 || ''}`,
                city: source.city,
                state: source.state,
                zip: source.postcode,
                country: source.country
            };
        } else {
            // Fallback / Preview Data
            displayData = block.type === 'billing_address' ? data.billing : data.shipping;
        }

        const label = block.type === 'billing_address' ? 'Bill To' : 'Ship To';
        return (
            <div style={style}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#64748b', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>{label}</div>
                <div style={{ lineHeight: '1.5' }}>
                    <div style={{ fontWeight: '600' }}>{displayData.name}</div>
                    <div>{displayData.address}</div>
                    <div>{displayData.city}, {displayData.state} {displayData.zip}</div>
                    <div>{displayData.country}</div>
                </div>
            </div>
        );
    }

    // Line Items
    if (block.type === 'line_items') {
        const items = data.line_items || [];
        const currency = data.currency || '$';

        return (
            <div style={{ width: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={{ textAlign: 'left', padding: '10px' }}>Item</th>
                            <th style={{ textAlign: 'center', padding: '10px' }}>Qty</th>
                            <th style={{ textAlign: 'right', padding: '10px' }}>Price</th>
                            <th style={{ textAlign: 'right', padding: '10px' }}>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, idx) => (
                            <tr key={item.id || idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                <td style={{ padding: '10px' }}>
                                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                                    {/* Render Metadata if available */}
                                    {item.meta_data && item.meta_data.length > 0 && (
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                            {item.meta_data
                                                .filter(m => !m.key.startsWith('_'))
                                                .map(m => `${m.display_key || m.key}: ${m.display_value || m.value}`)
                                                .join(', ')}
                                        </div>
                                    )}
                                </td>
                                <td style={{ textAlign: 'center', padding: '10px' }}>{item.quantity}</td>
                                <td style={{ textAlign: 'right', padding: '10px' }}>
                                    {currency}{parseFloat(item.price || 0).toFixed(2)}
                                </td>
                                <td style={{ textAlign: 'right', padding: '10px' }}>
                                    {currency}{parseFloat(item.total || item.subtotal || 0).toFixed(2)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    // Totals
    if (block.type === 'totals') {
        const currency = data.currency || '$';
        const total = parseFloat(data.total || 0).toFixed(2);
        const subtotal = data.line_items
            ? (parseFloat(data.total || 0) - parseFloat(data.total_tax || 0) - parseFloat(data.shipping_total || 0)).toFixed(2)
            : total; // Fallback if simple data
        const tax = parseFloat(data.total_tax || 0).toFixed(2);
        const shipping = parseFloat(data.shipping_total || 0).toFixed(2);

        return (
            <div style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: block.align === 'left' ? 'flex-start' : 'flex-end' }}>
                <div style={{ minWidth: '200px', fontSize: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                        <span style={{ color: '#64748b' }}>Subtotal</span>
                        <span>{currency}{subtotal}</span>
                    </div>
                    {parseFloat(shipping) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                            <span style={{ color: '#64748b' }}>Shipping</span>
                            <span>{currency}{shipping}</span>
                        </div>
                    )}
                    {parseFloat(tax) > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                            <span style={{ color: '#64748b' }}>Tax</span>
                            <span>{currency}{tax}</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px', borderTop: '2px solid #000', marginTop: '8px', paddingTop: '8px' }}>
                        <span>Total</span>
                        <span>{currency}{total}</span>
                    </div>
                </div>
            </div>
        );
    }

    // Order Info
    if (block.type === 'order_info') {
        const infoStyle = { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' };

        let orderDate = data.order_date;
        if (!orderDate && data.date_created) {
            orderDate = new Date(data.date_created).toLocaleDateString();
        }

        return (
            <div style={style}>
                <div style={infoStyle}>
                    <span style={{ fontWeight: 600 }}>Order #:</span>
                    <span>{data.order_number || data.id}</span>
                </div>
                <div style={infoStyle}>
                    <span style={{ fontWeight: 600 }}>Date:</span>
                    <span>{orderDate}</span>
                </div>
                <div style={infoStyle}>
                    <span style={{ fontWeight: 600 }}>Payment Method:</span>
                    <span>{data.payment_method_title || data.payment_method}</span>
                </div>
            </div>
        );
    }

    return <div>Unknown Block</div>;
};

export const InvoiceRenderer = ({ layout, data, footerText }) => {
    if (!layout || !Array.isArray(layout)) return <div>Invalid Layout</div>;

    return (
        <div className="invoice-paper" style={{
            background: 'white',
            color: 'black',
            padding: '40px',
            minHeight: '297mm', // A4 Height
            width: '210mm',     // A4 Width
            margin: '0 auto',
            boxSizing: 'border-box',
            position: 'relative'
        }}>
            {layout.map(row => (
                <div key={row.id} style={{ display: 'flex', minHeight: '50px', marginBottom: '10px' }}>
                    {row.columns.map(col => (
                        <div key={col.id} style={{ width: `${col.width}%`, padding: '0 10px' }}>
                            {col.blocks.map(block => (
                                <div key={block.id} style={{ marginBottom: '10px' }}>
                                    <InvoiceBlockRenderer block={block} data={data} />
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            ))}

            {/* Footer */}
            {footerText && (
                <div style={{
                    marginTop: 'auto',
                    padding: '20px',
                    borderTop: '2px solid #e2e8f0',
                    textAlign: 'center',
                    fontSize: '12px',
                    color: '#64748b'
                }}>
                    {footerText}
                </div>
            )}
        </div>
    );
};
