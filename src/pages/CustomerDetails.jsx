import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { ArrowLeft, Mail, MapPin, Phone, ShoppingBag, Calendar, DollarSign, Plus, Trash2, StickyNote } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import './CustomerDetails.css';

const CustomerDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const customerId = parseInt(id);

    // Fetch data
    const customer = useLiveQuery(() => db.customers.get(customerId).then(result => result === undefined ? null : result), [customerId]);
    const orders = useLiveQuery(() => db.orders.where('customer_id').equals(customerId).reverse().sortBy('date_created'), [customerId]);
    const notes = useLiveQuery(() => db.customer_notes.where('customer_id').equals(customerId).reverse().sortBy('date_created'), [customerId]);

    const [noteContent, setNoteContent] = useState('');

    const stats = useMemo(() => {
        if (!orders) return { totalSpent: 0, orderCount: 0, avgOrder: 0 };
        const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.total), 0);
        return {
            totalSpent,
            orderCount: orders.length,
            avgOrder: orders.length ? totalSpent / orders.length : 0
        };
    }, [orders]);

    const chartData = useMemo(() => {
        if (!orders) return [];
        // Sort chrono
        const sorted = [...orders].sort((a, b) => new Date(a.date_created) - new Date(b.date_created));

        // Group by Month
        const grouped = {};
        sorted.forEach(o => {
            const date = new Date(o.date_created);
            const key = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            grouped[key] = (grouped[key] || 0) + parseFloat(o.total);
        });

        return Object.entries(grouped).map(([date, total]) => ({ date, total }));
    }, [orders]);

    const handleAddNote = async () => {
        if (!noteContent.trim()) return;
        try {
            await db.customer_notes.add({
                customer_id: customerId,
                content: noteContent,
                date_created: new Date(),
                author: 'Admin'
            });
            setNoteContent('');
            toast.success('Note added');
        } catch {
            toast.error('Failed to add note');
        }
    };

    const handleDeleteNote = async (noteId) => {
        if (window.confirm('Delete this note?')) {
            await db.customer_notes.delete(noteId);
            toast.success('Note deleted');
        }
    };

    const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    const getInitials = (first, last) => `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

    if (customer === undefined) return <div className="p-8">Loading customer...</div>;
    if (customer === null) return (
        <div className="p-8 text-center">
            <h3>Customer not found</h3>
            <p className="text-muted">The customer with ID #{customerId} could not be found in the local database.</p>
            <button onClick={() => navigate('/customers')} className="btn btn-secondary mt-4">Back to Customers</button>
        </div>
    );

    return (
        <div className="customer-details-page">
            <div className="mb-6">
                <button onClick={() => navigate('/customers')} className="btn" style={{ background: 'transparent', paddingLeft: 0, color: 'var(--text-muted)' }}>
                    <ArrowLeft size={18} /> Back to Customers
                </button>
            </div>

            <div className="customer-profile-grid">
                {/* Left Column: Profile & Notes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {/* Profile Card */}
                    <div className="glass-panel profile-card">
                        <div className="large-avatar">
                            {getInitials(customer.first_name, customer.last_name)}
                        </div>
                        <h2>{customer.first_name} {customer.last_name}</h2>
                        <span className="role-badge">{customer.role}</span>
                        <div className="profile-details">
                            <div className="detail-row"><Mail size={16} /> {customer.email}</div>
                            <div className="detail-row"><MapPin size={16} /> {customer.billing?.city || 'Unknown'}, {customer.billing?.country || ''}</div>
                            <div className="detail-row"><Phone size={16} /> {customer.billing?.phone || 'No phone'}</div>
                        </div>
                    </div>

                    {/* Notes Section */}
                    <div className="glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <StickyNote size={18} /> Internal Notes
                        </h3>
                        <div className="notes-list" style={{ maxHeight: '300px', overflowY: 'auto', margin: '1rem 0' }}>
                            {notes?.map(note => (
                                <div key={note.id} className="note-item" style={{
                                    padding: '1rem',
                                    background: 'rgba(255,255,255,0.03)',
                                    borderRadius: '8px',
                                    marginBottom: '8px',
                                    border: '1px solid var(--border-glass)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {new Date(note.date_created).toLocaleString()} by {note.author}
                                        </span>
                                        <button onClick={() => handleDeleteNote(note.id)} className="btn-icon hover-red" style={{ padding: 0 }}>
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    <p style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{note.content}</p>
                                </div>
                            ))}
                            {(!notes || notes.length === 0) && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No notes yet.</p>}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                className="form-input"
                                placeholder="Add a note..."
                                value={noteContent}
                                onChange={(e) => setNoteContent(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                            />
                            <button className="btn btn-primary" onClick={handleAddNote} disabled={!noteContent.trim()}>
                                <Plus size={18} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column: Stats & Order History */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', flex: 1 }}>

                    {/* Stats Grid */}
                    <div className="customer-stats-grid">
                        <div className="stat-box glass-panel">
                            <span className="stat-label"><DollarSign size={14} /> Total Spent</span>
                            <span className="stat-value text-success">{formatCurrency(stats.totalSpent)}</span>
                        </div>
                        <div className="stat-box glass-panel">
                            <span className="stat-label"><ShoppingBag size={14} /> Total Orders</span>
                            <span className="stat-value">{stats.orderCount}</span>
                        </div>
                        <div className="stat-box glass-panel">
                            <span className="stat-label"><DollarSign size={14} /> Avg. Order</span>
                            <span className="stat-value">{formatCurrency(stats.avgOrder)}</span>
                        </div>
                    </div>

                    {/* Spending Chart */}
                    <div className="glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 className="section-title">Spending History</h3>
                        <div style={{ height: '300px', marginTop: '1rem' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData}>
                                    <defs>
                                        <linearGradient id="colorSplit" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickMargin={10} />
                                    <YAxis stroke="#64748b" tickFormatter={(v) => `$${v}`} fontSize={12} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                                        formatter={(val) => formatCurrency(val)}
                                    />
                                    <Area type="monotone" dataKey="total" stroke="#10b981" fillOpacity={1} fill="url(#colorSplit)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Order History Table */}
                    <div className="glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 className="section-title">Order History</h3>
                        <div className="table-responsive">
                            <table className="products-table">
                                <thead>
                                    <tr>
                                        <th>Order</th>
                                        <th>Date</th>
                                        <th>Status</th>
                                        <th>Items</th>
                                        <th>Total</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orders && orders.length > 0 ? (
                                        orders.map(order => (
                                            <tr key={order.id}>
                                                <td style={{ fontWeight: '600' }}>#{order.id}</td>
                                                <td className="text-muted">{new Date(order.date_created).toLocaleDateString()}</td>
                                                <td>
                                                    <span className={`status-badge status-${order.status}`}>{order.status}</span>
                                                </td>
                                                <td>{order.line_items?.length || 0} items</td>
                                                <td className="price-text">{formatCurrency(order.total)}</td>
                                                <td>
                                                    <button
                                                        className="btn icon-btn"
                                                        style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)' }}
                                                        onClick={() => navigate(`/orders/${order.id}`)}
                                                    >
                                                        View
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                                No orders found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


export default CustomerDetails;
