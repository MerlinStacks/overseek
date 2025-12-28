import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

export const useProductStats = (rangeOption = { label: 'Last 30 Days', days: 30 }) => {
    const orders = useLiveQuery(() => db.orders.toArray()) || [];
    const products = useLiveQuery(() => db.products.toArray()) || [];

    const stats = useMemo(() => {
        if (!orders.length) return null;

        // Create Product Cost Lookup
        const productCosts = new Map();
        products.forEach(p => {
            productCosts.set(p.id, parseFloat(p.cost_price || 0));
        });

        const now = new Date();
        const days = rangeOption.days || 36500;
        const startRaw = new Date(now);
        startRaw.setDate(now.getDate() - days);
        const start = startRaw.getTime(); // Comparison timestamp

        const productMap = new Map();

        orders.forEach(order => {
            if (!order.date_created) return;
            const d = new Date(order.date_created).getTime();
            if (d < start) return;

            if (order.line_items && Array.isArray(order.line_items)) {
                order.line_items.forEach(item => {
                    const id = item.product_id;
                    if (!productMap.has(id)) {
                        productMap.set(id, {
                            id,
                            name: item.name || 'Unknown Product',
                            sku: item.sku || '',
                            netSales: 0,
                            itemsSold: 0,
                            totalCost: 0,
                            ordersCount: 0,
                            orderIds: new Set()
                        });
                    }
                    const p = productMap.get(id);
                    const qty = parseInt(item.quantity || 0);
                    const revenue = parseFloat(item.total || 0);
                    const costUnit = productCosts.get(id) || 0;

                    p.netSales += revenue;
                    p.itemsSold += qty;
                    p.totalCost += (costUnit * qty);
                    p.orderIds.add(order.id);
                });
            }
        });

        // Convert Map to Array
        const allProducts = Array.from(productMap.values()).map(p => {
            const profit = p.netSales - p.totalCost;
            const margin = p.netSales > 0 ? (profit / p.netSales) * 100 : 0;
            return {
                ...p,
                ordersCount: p.orderIds.size,
                netSales: parseFloat(p.netSales.toFixed(2)), // formatting
                profit: parseFloat(profit.toFixed(2)),
                margin: parseFloat(margin.toFixed(1))
            };
        });

        // Sorts
        const topSellers = [...allProducts].sort((a, b) => b.netSales - a.netSales).slice(0, 5);
        const topProfit = [...allProducts].sort((a, b) => b.profit - a.profit).slice(0, 5);
        const topVolume = [...allProducts].sort((a, b) => b.itemsSold - a.itemsSold).slice(0, 5);
        const worstSellers = [...allProducts].sort((a, b) => a.netSales - b.netSales).slice(0, 5);

        const totalRevenue = allProducts.reduce((sum, p) => sum + p.netSales, 0);
        const totalProfit = allProducts.reduce((sum, p) => sum + p.profit, 0);

        return {
            allProducts,
            topSellers,
            topProfit,
            topVolume,
            worstSellers,
            totalItemsSold: allProducts.reduce((sum, p) => sum + p.itemsSold, 0),
            totalRevenue,
            totalProfit,
            netMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
        };

    }, [orders, products, rangeOption]);

    return stats || { allProducts: [], topSellers: [], topProfit: [], topVolume: [], worstSellers: [], totalItemsSold: 0, totalRevenue: 0, totalProfit: 0, netMargin: 0 };
};
