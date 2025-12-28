import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, TrendingUp, TrendingDown, DollarSign, ShoppingCart, Filter, Layers, Users, Zap, BarChart2, Repeat, Box } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useLiveQuery } from 'dexie-react-hooks';
import { useProductStats } from '../hooks/useProductStats';
import { db } from '../db/db';
import DateRangePicker from '../components/DateRangePicker';
import './ProductReports.css';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

const ProductReports = () => {
    const [dateRange, setDateRange] = useState({ label: 'Last 30 Days', days: 30 });
    const [searchParams] = useSearchParams();
    const activeSection = searchParams.get('view') || 'overview';

    // Core Data
    const { allProducts, topSellers, topVolume, worstSellers, totalItemsSold, totalProfit, netMargin } = useProductStats(dateRange);
    const products = useLiveQuery(() => db.products.toArray()) || [];
    const orders = useLiveQuery(() => db.orders.toArray()) || [];

    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    // --- Analysis Logic ---

    // 1. Bought Together Analysis
    const boughtTogether = useMemo(() => {
        if (!orders.length) return [];
        const pairs = {};
        const productInfo = new Map(products.map(p => [p.id, p]));

        orders.forEach(order => {
            if (!order.line_items || order.line_items.length < 2) return;
            // Sort items by ID to split duplicates e.g. A-B is same as B-A
            const items = order.line_items.map(i => i.product_id).sort((a, b) => a - b);

            // Generate pairs
            for (let i = 0; i < items.length; i++) {
                for (let j = i + 1; j < items.length; j++) {
                    const id1 = items[i];
                    const id2 = items[j];
                    if (id1 === id2) continue;
                    const key = `${id1}-${id2}`;
                    pairs[key] = (pairs[key] || 0) + 1;
                }
            }
        });

        return Object.entries(pairs)
            .map(([key, count]) => {
                const [id1, id2] = key.split('-').map(Number);
                const p1 = productInfo.get(id1);
                const p2 = productInfo.get(id2);
                return {
                    id: key,
                    p1: p1 || { name: 'Unknown', id: id1 },
                    p2: p2 || { name: 'Unknown', id: id2 },
                    count
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 20); // Top 20
    }, [orders, products]);

    // 2. Stock Velocity
    const stockVelocity = useMemo(() => {
        if (!allProducts.length) return [];

        return allProducts.map(stat => {
            const product = products.find(p => p.id === stat.id) || {};
            const stock = product.stock_quantity || 0;
            const velocity = stat.itemsSold / (dateRange.days || 30); // items per day
            const daysRemaining = velocity > 0 ? (stock / velocity) : 9999;

            return {
                ...stat,
                stock,
                velocity,
                daysRemaining
            };
        }).sort((a, b) => {
            // Sort by "Urgency" (fewest days remaining, but ignore 0 velocity)
            if (a.velocity === 0) return 1;
            if (b.velocity === 0) return -1;
            return a.daysRemaining - b.daysRemaining;
        });
    }, [allProducts, products, dateRange]);


    // --- View Components ---

    const OverviewView = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* KPIs */}
            <div className="dashboard-grid">
                <div className="glass-card stat-card">
                    <div className="stat-header">
                        <div>
                            <h3 className="stat-title">Best Revenue</h3>
                            <p className="stat-value">{topSellers[0]?.name || '-'}</p>
                            <p className="stat-subtext">{topSellers[0] ? `${formatCurrency(topSellers[0].netSales)} revenue` : ''}</p>
                        </div>
                        <div className="icon-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                            <TrendingUp size={24} />
                        </div>
                    </div>
                </div>
                <div className="glass-card stat-card">
                    <div className="stat-header">
                        <div>
                            <h3 className="stat-title">Total Volume</h3>
                            <p className="stat-value">{totalItemsSold}</p>
                            <p className="stat-subtext">Items sold in period</p>
                        </div>
                        <div className="icon-box" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>
                            <ShoppingCart size={24} />
                        </div>
                    </div>
                </div>
                <div className="glass-card stat-card">
                    <div className="stat-header">
                        <div>
                            <h3 className="stat-title">Total Profit</h3>
                            <p className="stat-value">{formatCurrency(totalProfit)}</p>
                            <p className="stat-subtext">Margin: {netMargin.toFixed(1)}%</p>
                        </div>
                        <div className="icon-box" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                            <DollarSign size={24} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))' }}>
                <div className="glass-panel" style={{ minHeight: '400px', padding: '1.5rem' }}>
                    <h3 className="section-title">Revenue Leaders</h3>
                    <div style={{ width: '100%', height: '300px', marginTop: '1rem' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={topSellers} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                                <XAxis type="number" stroke="#64748b" tickFormatter={(val) => `$${val}`} />
                                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12, fill: '#cbd5e1' }} stroke="#cbd5e1" />
                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} formatter={(value) => formatCurrency(value)} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                                <Bar dataKey="netSales" radius={[0, 4, 4, 0]} barSize={20}>
                                    {topSellers.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <h3 className="section-title">Top Sellers (Volume)</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                        {topVolume.map((p, i) => (
                            <div key={p.id} className="pair-card" style={{ padding: '0.75rem', borderRadius: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <div className="pair-item">
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '50%',
                                        background: i < 3 ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
                                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 'bold'
                                    }}>
                                        {i + 1}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.sku || 'No SKU'}</div>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{p.itemsSold}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>sold</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );

    const BoughtTogetherView = () => (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="section-title">Frequently Bought Together</h3>
            <p className="reports-section-subtitle" style={{ marginBottom: '1.5rem' }}>Common product combinations from orders.</p>

            <div className="bought-together-grid">
                {boughtTogether.map((pair, idx) => (
                    <div key={pair.id} className="glass-card pair-card">
                        <div className="pair-info">
                            {/* Connector Line */}
                            <div className="pair-connector"></div>

                            <div className="pair-item">
                                <div className="pair-icon">A</div>
                                <span style={{ fontWeight: 500 }}>{pair.p1.name}</span>
                            </div>
                            <div className="pair-item">
                                <div className="pair-icon">B</div>
                                <span style={{ fontWeight: 500 }}>{pair.p2.name}</span>
                            </div>
                        </div>
                        <div className="pair-count-box">
                            <div className="pair-count-val">{pair.count}</div>
                            <div className="pair-count-label">Orders</div>
                        </div>
                    </div>
                ))}

                {boughtTogether.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                        <Users size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                        <p>No product combinations found yet.</p>
                    </div>
                )}
            </div>
        </div>
    );

    const StockVelocityView = () => (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="section-title">Stock Velocity</h3>
            <p className="reports-section-subtitle" style={{ marginBottom: '1.5rem' }}>Estimated days of stock remaining based on sales velocity.</p>

            <div className="table-container">
                <table className="velocity-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th style={{ textAlign: 'right' }}>In Stock</th>
                            <th style={{ textAlign: 'right' }}>Sales / Day</th>
                            <th style={{ textAlign: 'right' }}>Est. Days Left</th>
                            <th style={{ textAlign: 'center' }}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stockVelocity.map(p => {
                            let statusClass = 'status-healthy';
                            let statusText = 'Healthy';
                            if (p.stock === 0) {
                                statusClass = 'status-critical'; // Red
                                statusText = 'Out of Stock';
                            } else if (p.daysRemaining < 7) {
                                statusClass = 'status-critical';
                                statusText = 'Critical';
                            } else if (p.daysRemaining < 30) {
                                statusClass = 'status-low';
                                statusText = 'Low';
                            }

                            return (
                                <tr key={p.id}>
                                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                                    <td style={{ textAlign: 'right' }}>{p.stock}</td>
                                    <td style={{ textAlign: 'right' }}>{p.velocity.toFixed(2)}</td>
                                    <td style={{ textAlign: 'right' }}>{isFinite(p.daysRemaining) ? Math.floor(p.daysRemaining) : '∞'}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        <span className={`status-capsule ${statusClass}`}>
                                            {statusText}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const ProductsTable = ({ data }) => (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="section-title">All Products</h3>
            <div className="table-container" style={{ marginTop: '1rem', maxHeight: '600px', overflowY: 'auto' }}>
                <table className="velocity-table">
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 10 }}>
                        <tr>
                            <th>Product</th>
                            <th style={{ textAlign: 'right' }}>Sold</th>
                            <th style={{ textAlign: 'right' }}>Revenue</th>
                            <th style={{ textAlign: 'right' }}>Profit</th>
                            <th style={{ textAlign: 'right' }}>Margin</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((p) => (
                            <tr key={p.id}>
                                <td style={{ fontWeight: 500 }}>{p.name}</td>
                                <td style={{ textAlign: 'right' }}>{p.itemsSold}</td>
                                <td style={{ textAlign: 'right', color: '#10b981' }}>{formatCurrency(p.netSales)}</td>
                                <td style={{ textAlign: 'right', color: '#f59e0b' }}>{formatCurrency(p.profit)}</td>
                                <td style={{ textAlign: 'right' }}>{p.margin}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // --- Render ---

    const sectionTitles = {
        'overview': 'Overview',
        'products': 'Products',
        'top_sellers': 'Top Sellers',
        'bought_together': 'Bought Together',
        'velocity': 'Stock Velocity'
    };

    return (
        <div className="product-reports-container">
            <div className="reports-page-header">
                <div>
                    <h1 className="reports-section-title">
                        {sectionTitles[activeSection] || 'Overview'}
                    </h1>
                    <p className="reports-section-subtitle">Analysis for {dateRange.label}</p>
                </div>
                <DateRangePicker range={dateRange} onChange={setDateRange} showCompare={false} />
            </div>

            {/* Content Switcher */}
            {activeSection === 'overview' && <OverviewView />}
            {activeSection === 'products' && <ProductsTable data={allProducts} />}
            {activeSection === 'top_sellers' && <ProductsTable data={topSellers} />}
            {activeSection === 'bought_together' && <BoughtTogetherView />}
            {activeSection === 'velocity' && <StockVelocityView />}
        </div>
    );
};

export default ProductReports;
