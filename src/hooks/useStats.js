import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

export const useStats = (rangeOption = { label: 'Last 30 Days', days: 30 }, compareMode = 'none') => { // Changed compare to compareMode
    const rawOrders = useLiveQuery(async () => {
        const days = rangeOption.days || 36500;

        // Optimize: If looking at "All Time" (large range), sadly we need everything.
        // But most users land on "Last 30 Days".
        // Threshold: If days is massive (e.g. > 1000 ~ 3 years), fetch all.
        if (days > 1000) return await db.orders.toArray();

        const now = new Date();

        // Calculate how far back we need to query
        let limitDate = new Date(now);

        // Base range
        let daysBack = days;

        if (compareMode === 'year') {
            // Need data from last year same period
            daysBack += 366;
        } else if (compareMode !== 'none') {
            // Need data from previous period
            daysBack *= 2;
        }

        // Add a buffer (e.g. 7 days) to handle timezone shifts / edge cases safely
        daysBack += 7;

        limitDate.setDate(limitDate.getDate() - daysBack);
        const isoDate = limitDate.toISOString();

        // Query only recent orders
        // Note: 'date_created' IS indexed in orders_v2 schema.
        return await db.orders.where('date_created').aboveOrEqual(isoDate).toArray();

    }, [rangeOption.days, compareMode]);

    const orders = rawOrders || [];
    const loading = rawOrders === undefined;

    // Optimization: Only fetch products that are actually in the retrieved orders
    const products = useLiveQuery(async () => {
        if (!orders || orders.length === 0) return [];

        // Collect all unique compound keys: [account_id, product_id]
        const compoundKeys = [];
        const seen = new Set();

        orders.forEach(o => {
            if (o.line_items && o.account_id) {
                o.line_items.forEach(i => {
                    const keyStr = `${o.account_id}-${i.product_id}`;
                    if (!seen.has(keyStr)) {
                        seen.add(keyStr);
                        // Dexie compound keys are arrays -> [account_id, product_id]
                        compoundKeys.push([o.account_id, i.product_id]);
                    }
                });
            }
        });

        if (compoundKeys.length === 0) return [];

        // Fix: Use bulkGet with compound keys instead of where('id')
        // This resolves the Uncaught DexieError2
        const results = await db.products.bulkGet(compoundKeys);
        return results.filter(Boolean);
    }, [orders]) || [];

    const customers = useLiveQuery(() => db.customers.toArray()) || [];

    const stats = useMemo(() => {
        if (!orders.length) return null;

        // --- 1. Date Calculation ---
        const now = new Date();
        const days = rangeOption.days || 36500; // All time fallback

        // Initialize date variables
        const endCurrent = new Date(now);
        const startCurrent = new Date(now);
        const endPrevious = new Date(now);
        const startPrevious = new Date(now);
        let offsetDays = days;

        if (rangeOption.type === 'today') {
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            startCurrent.setTime(todayStart.getTime());
            endCurrent.setTime(now.getTime());

            // Previous: Yesterday same time (for fair pacing)
            startPrevious.setTime(todayStart.getTime());
            startPrevious.setDate(startPrevious.getDate() - 1);

            endPrevious.setTime(endCurrent.getTime());
            endPrevious.setDate(endPrevious.getDate() - 1);

            offsetDays = 1;
        } else if (rangeOption.type === 'yesterday') {
            const yestStart = new Date(now);
            yestStart.setDate(yestStart.getDate() - 1);
            yestStart.setHours(0, 0, 0, 0);

            const yestEnd = new Date(yestStart);
            yestEnd.setHours(23, 59, 59, 999);

            startCurrent.setTime(yestStart.getTime());
            endCurrent.setTime(yestEnd.getTime());

            // Previous: Day before yesterday
            startPrevious.setTime(yestStart.getTime());
            startPrevious.setDate(startPrevious.getDate() - 1);

            endPrevious.setTime(yestEnd.getTime());
            endPrevious.setDate(endPrevious.getDate() - 1);

            offsetDays = 1;
        } else if (compareMode === 'year') {
            // ... existing year logic ...
            endPrevious.setTime(endCurrent.getTime());
            endPrevious.setDate(endPrevious.getDate() - 365);

            startPrevious.setTime(startCurrent.getTime());
            startPrevious.setDate(startPrevious.getDate() - 365);
            offsetDays = 365;
        } else {
            // Standard Period Moving Window
            startCurrent.setDate(now.getDate() - days);

            // Previous Period
            endPrevious.setTime(startCurrent.getTime()); // Prev ends where curr starts
            startPrevious.setTime(endPrevious.getTime());
            startPrevious.setDate(startPrevious.getDate() - days);
        }

        const isComparing = compareMode !== 'none';

        // --- 2. Cost Map ---
        const productCostMap = new Map();
        products.forEach(p => productCostMap.set(p.id, parseFloat(p.cost_price || 0)));

        // --- 3. Process Orders ---
        let currentMetrics = { sales: 0, cost: 0, profit: 0, orders: 0 };
        let prevMetrics = { sales: 0, cost: 0, profit: 0, orders: 0 };

        const chartMap = new Map(); // Date -> { sales, profit, prevSales, prevProfit }
        const topProductMap = new Map(); // ProductId -> { count, revenue, name }

        // Initialize Chart Data for Current Period (fill gaps with 0)
        if (days < 1000) {
            for (let i = 0; i <= days; i++) {
                const d = new Date(startCurrent);
                d.setDate(d.getDate() + i);
                const dateKey = d.toLocaleDateString(); // Local identifier
                chartMap.set(dateKey, {
                    date: d,
                    label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                    sales: 0, profit: 0,
                    orders: 0,
                    prevSales: 0, prevProfit: 0 // Will fill later
                });
            }
        }

        orders.forEach(order => {
            if (!order.date_created) return;
            if (!['completed', 'processing'].includes(order.status)) return;
            const orderDate = new Date(order.date_created);

            const total = parseFloat(order.total || 0);
            let cost = 0;
            if (order.line_items) {
                order.line_items.forEach(item => {
                    const c = productCostMap.get(item.product_id) || 0;
                    cost += (c * (item.quantity || 1));
                });
            }
            const profit = total - cost;

            // Check Current Period
            if (orderDate >= startCurrent && orderDate <= endCurrent) {
                currentMetrics.sales += total;
                currentMetrics.cost += cost;
                currentMetrics.profit += profit;
                currentMetrics.orders += 1;

                // Track Top Products
                if (order.line_items && Array.isArray(order.line_items)) {
                    order.line_items.forEach(item => {
                        const pid = item.product_id;
                        const qty = item.quantity || 1;
                        const name = item.name || 'Unknown Product';

                        const current = topProductMap.get(pid) || { count: 0, revenue: 0, name, id: pid };
                        current.count += qty;
                        current.revenue += (parseFloat(item.total) || 0); // Assuming item.total exists or similar
                        if (!current.name || current.name === 'Unknown Product') current.name = name;
                        topProductMap.set(pid, current);
                    });
                }

                // Charting
                const dateKey = orderDate.toLocaleDateString();
                const entry = chartMap.get(dateKey);
                if (entry) {
                    entry.sales += total;
                    entry.profit += profit;
                    entry.orders += 1;
                } else if (rangeOption.label === 'All Time') {
                    // For All Time, dynamic init
                    if (!chartMap.has(dateKey)) {
                        chartMap.set(dateKey, {
                            date: orderDate,
                            label: orderDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                            sales: 0, profit: 0, prevSales: 0, prevProfit: 0
                        });
                    }
                    const e = chartMap.get(dateKey);
                    e.sales += total;
                    e.profit += profit;
                }
            }
            // Check Previous Period
            else if (isComparing && orderDate >= startPrevious && orderDate <= endPrevious) {

                prevMetrics.sales += total;
                prevMetrics.cost += cost;
                prevMetrics.profit += profit;
                prevMetrics.orders += 1;

                // For Chart Mapping
                if (days < 1000) {
                    const targetDate = new Date(orderDate);
                    targetDate.setDate(targetDate.getDate() + offsetDays); // Shift forward to overlay
                    const targetKey = targetDate.toLocaleDateString();
                    const entry = chartMap.get(targetKey);

                    if (entry) {
                        entry.prevSales += total;
                        entry.prevProfit += profit;
                    }
                }
            }
        });

        // --- 4. Final Processing ---
        const avgOrderValue = currentMetrics.orders > 0 ? currentMetrics.sales / currentMetrics.orders : 0;

        // Flatten Chart Data
        const chartData = Array.from(chartMap.values())
            .sort((a, b) => a.date - b.date);

        // Calculate Top Products List
        const topProducts = Array.from(topProductMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(p => {
                // Try to get cleaner name from products list if available
                const productInfo = products.find(prod => prod.id === p.id);
                return {
                    ...p,
                    name: productInfo ? productInfo.name : p.name
                };
            });

        // Status Distribution
        const statusMap = new Map();
        orders.forEach(o => {
            if (!o.status) return;
            if (!o.date_created) return;
            const d = new Date(o.date_created);
            if (d >= startCurrent && d <= endCurrent) {
                statusMap.set(o.status, (statusMap.get(o.status) || 0) + 1);
            }
        });
        const statusDistribution = Array.from(statusMap.entries()).map(([name, value]) => ({ name, value }));

        // Calculate Comparison Stats
        const getChange = (curr, prev) => {
            if (prev === 0) return curr > 0 ? 100 : 0;
            return ((curr - prev) / prev) * 100;
        };

        const comparison = {
            salesChange: getChange(currentMetrics.sales, prevMetrics.sales),
            profitChange: getChange(currentMetrics.profit, prevMetrics.profit),
            ordersChange: getChange(currentMetrics.orders, prevMetrics.orders),
            aovChange: getChange(avgOrderValue, (prevMetrics.orders > 0 ? prevMetrics.sales / prevMetrics.orders : 0))
        };

        return {
            totalSales: currentMetrics.sales,
            totalOrders: currentMetrics.orders,
            totalProfit: currentMetrics.profit,
            avgOrderValue,
            chartData,
            statusDistribution,
            topProducts,
            comparison,
            showCompare: isComparing, // Boolean for UI
            compareMode, // Pass back mode if needed
            prevSales: prevMetrics.sales
        };

    }, [orders, products, rangeOption, compareMode]);

    const defaultStats = {
        totalSales: 0, totalOrders: 0, totalProfit: 0, avgOrderValue: 0,
        chartData: [], statusDistribution: [], topProducts: [], comparison: {}, showCompare: false
    };

    return { ...(stats || defaultStats), loading };
};
