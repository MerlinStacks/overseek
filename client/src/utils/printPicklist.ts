
interface PicklistItem {
    productId: string;
    sku: string;
    name: string;
    binLocation: string;
    quantityUpdates: { orderNumber: string; quantity: number; wooOrderId: number }[];
    totalQuantity: number;
    stockStatus: string;
}

export function printPicklist(items: PicklistItem[]) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups to print the picklist');
        return;
    }

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Picklist - ${new Date().toLocaleDateString()}</title>
            <style>
                body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th { text-align: left; border-bottom: 2px solid #000; padding: 10px; }
                td { border-bottom: 1px solid #ddd; padding: 10px; vertical-align: top; }
                .bin { font-family: monospace; font-weight: bold; font-size: 1.2em; }
                .qty { font-weight: bold; font-size: 1.2em; text-align: center; }
                .orders { font-size: 0.85em; color: #555; }
                .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
                h1 { margin: 0; }
                @media print {
                    @page { margin: 1cm; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>Picklist</h1>
                    <p>Generated: ${new Date().toLocaleString()}</p>
                </div>
                <div>
                    <strong>Total Items: ${items.length}</strong>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 15%">Bin Loc</th>
                        <th style="width: 50%">Product</th>
                        <th style="width: 10%; text-align: center">Total Qty</th>
                        <th style="width: 25%">Orders</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td class="bin">${item.binLocation || 'N/A'}</td>
                            <td>
                                <div>${item.name}</div>
                                <div style="font-size: 0.8em; color: #666;">SKU: ${item.sku}</div>
                                ${item.stockStatus !== 'instock' ? '<div style="color: red; font-size: 0.8em; font-weight: bold;">⚠️ OUT OF STOCK</div>' : ''}
                            </td>
                            <td class="qty">${item.totalQuantity}</td>
                            <td class="orders">
                                ${item.quantityUpdates.map(u =>
        `<span style="display: inline-block; background: #f0f0f0; border: 1px solid #ccc; border-radius: 3px; padding: 2px 4px; margin: 2px;">#${u.orderNumber} (${u.quantity})</span>`
    ).join('')}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
}
