import { db } from '../db/db';
import DOMPurify from 'dompurify';

// Helper to fetch orders based on range
const fetchOrders = async (range) => {
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - range.days);
    return await db.orders.where('date_created').between(start.toISOString(), now.toISOString()).toArray();
};

export const generatePDF = async (reportType, dateRange) => {
    // Dynamic import to keep bundle size low
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.text(`${reportType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Report`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 30);

    // Data Fetching logic based on type
    let head = [];
    let body = [];

    if (reportType === 'sales') {
        const orders = await fetchOrders(dateRange);
        head = [['Order ID', 'Date', 'Customer', 'Items', 'Total']];
        body = orders.map(o => [o.id, new Date(o.date_created).toLocaleDateString(), `${o.billing?.first_name} ${o.billing?.last_name}`, o.line_items?.length || 0, `$${o.total}`]);

        // Summary
        const total = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
        doc.text(`Total Sales: $${total.toFixed(2)}`, 14, 40);
    } else if (reportType === 'inventory') {
        const products = await db.products.toArray();
        head = [['SKU', 'Name', 'Stock', 'Price']];
        body = products.map(p => [p.sku, p.name, p.stock_quantity, `$${p.price}`]);
    } else if (reportType === 'price_updates') {
        const products = await db.products.toArray();
        // Sort by date_modified desc
        products.sort((a, b) => new Date(b.date_modified) - new Date(a.date_modified));

        head = [['SKU', 'Name', 'Current Price', 'Last Updated']];
        body = products.map(p => [
            p.sku,
            p.name,
            `$${p.price}`,
            p.date_modified ? new Date(p.date_modified).toLocaleDateString() + ' ' + new Date(p.date_modified).toLocaleTimeString() : 'N/A'
        ]);
    } else if (reportType === 'dead_stock') {
        const orders = await fetchOrders(dateRange);
        const soldProductIds = new Set();
        orders.forEach(o => o.line_items?.forEach(i => soldProductIds.add(i.product_id)));

        const allProducts = await db.products.toArray();
        const deadStock = allProducts.filter(p => !soldProductIds.has(p.id));

        doc.text(`Products with NO sales in the last ${dateRange.days} days`, 14, 40);

        head = [['SKU', 'Name', 'Stock', 'Price']];
        body = deadStock.map(p => [p.sku, p.name, p.stock_quantity, `$${p.price}`]);
    }

    autoTable(doc, {
        head: head,
        body: body,
        startY: 50,
    });

    doc.save(`${reportType}_report.pdf`);
};

export const generateCSV = async (reportType, dateRange) => {
    let data = [];
    let headers = [];

    if (reportType === 'sales') {
        const orders = await fetchOrders(dateRange);
        headers = ['Order ID', 'Date', 'Customer', 'Total'];
        data = orders.map(o => [o.id, o.date_created, `${o.billing?.first_name} ${o.billing?.last_name}`, o.total]);
    } else if (reportType === 'inventory') {
        const products = await db.products.toArray();
        headers = ['SKU', 'Name', 'Stock', 'Price'];
        data = products.map(p => [p.sku, p.name, p.stock_quantity, p.price]);
    } else if (reportType === 'price_updates') {
        const products = await db.products.toArray();
        products.sort((a, b) => new Date(b.date_modified) - new Date(a.date_modified));
        headers = ['SKU', 'Name', 'Current Price', 'Last Updated'];
        data = products.map(p => [p.sku, p.name, p.price, p.date_modified || '']);
    } else if (reportType === 'dead_stock') {
        const orders = await fetchOrders(dateRange);
        const soldProductIds = new Set();
        orders.forEach(o => o.line_items?.forEach(i => soldProductIds.add(i.product_id)));

        const allProducts = await db.products.toArray();
        const deadStock = allProducts.filter(p => !soldProductIds.has(p.id));

        headers = ['SKU', 'Name', 'Stock', 'Price'];
        data = deadStock.map(p => [p.sku, p.name, p.stock_quantity, p.price]);
    }

    const csvContent = headers.join(",") + "\n"
        + data.map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${reportType}_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const generateDigestHTML = async (report) => {
    const now = new Date();
    const start = new Date(now);
    if (report.frequency === 'Daily') start.setDate(now.getDate() - 1);
    if (report.frequency === 'Weekly') start.setDate(now.getDate() - 7);
    if (report.frequency === 'Monthly') start.setDate(now.getDate() - 30);

    const orders = await db.orders.where('date_created').between(start.toISOString(), now.toISOString()).toArray();
    const totalSales = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);

    // Basic HTML structure for preview
    let html = `<div style="font-family: sans-serif; padding: 20px; background: #f3f4f6;">`;
    html += `<div style="background: white; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto;">`;
    html += `<h2 style="color: #111827; margin-top: 0;">${report.title}</h2>`;
    html += `<p style="color: #6b7280;">Here is your ${report.frequency.toLowerCase()} summary.</p>`;

    if (report.metrics.includes('sales')) {
        html += `<div style="margin: 20px 0; padding: 15px; background: #eff6ff; border-radius: 6px;">`;
        html += `<div style="font-size: 12px; color: #6b7280;">TOTAL SALES</div>`;
        html += `<div style="font-size: 24px; font-weight: bold; color: #3b82f6;">$${totalSales.toFixed(2)}</div>`;
        html += `</div>`;
    }

    html += `<p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">Generated by WooDash</p>`;
    html += `</div></div>`;
    return DOMPurify.sanitize(html);
};
