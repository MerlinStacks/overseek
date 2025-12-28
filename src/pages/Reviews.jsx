import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAccount } from '../context/AccountContext';
import { Link } from 'react-router-dom';
import { Star, MessageSquare, Package, User, CheckCircle, XCircle, Search, Filter, Trash2 } from 'lucide-react';

const ReviewsPage = () => {
    const { activeAccount } = useAccount();

    // Fetch all reviews for this account
    // Note: In a larger app, we'd add an index on [account_id+date_created] for sorting
    const reviews = useLiveQuery(async () => {
        if (!activeAccount) return [];
        return await db.reviews
            .where({ account_id: activeAccount.id })
            .toArray();
    }, [activeAccount]) || [];

    // Sort by date descending (in memory)
    const sortedReviews = useMemo(() => {
        return [...reviews].sort((a, b) => new Date(b.date_created) - new Date(a.date_created));
    }, [reviews]);

    // Derived IDs for selective fetching
    const productIds = useMemo(() => [...new Set(reviews.map(r => r.product_id))], [reviews]);
    const customerIds = useMemo(() => [...new Set(reviews.map(r => r.customer_id))], [reviews]);

    // Fetch related entities using compound keys
    const products = useLiveQuery(async () => {
        if (!activeAccount || productIds.length === 0) return [];
        const keys = productIds.map(id => [activeAccount.id, id]);
        return (await db.products.bulkGet(keys)).filter(Boolean);
    }, [activeAccount, productIds]) || [];

    const customers = useLiveQuery(async () => {
        if (!activeAccount || customerIds.length === 0) return [];
        const keys = customerIds.map(id => [activeAccount.id, id]);
        return (await db.customers.bulkGet(keys)).filter(Boolean);
    }, [activeAccount, customerIds]) || [];

    const [filterStatus, setFilterStatus] = useState('all'); // all, approved, pending, spam
    const [searchTerm, setSearchTerm] = useState('');

    // Maps for easy lookup
    const productMap = useMemo(() => products.reduce((acc, p) => ({ ...acc, [p.id]: p }), {}), [products]);
    const customerMap = useMemo(() => customers.reduce((acc, c) => ({ ...acc, [c.id]: c }), {}), [customers]);

    // Filtering logic
    const filteredReviews = sortedReviews.filter(r => {
        // Status Filter
        if (filterStatus !== 'all' && r.status !== filterStatus) return false;

        // Search Filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            const contentMatch = (r.content || '').toLowerCase().includes(term);
            const product = productMap[r.product_id];
            const customer = customerMap[r.customer_id];
            const productMatch = product && product.name.toLowerCase().includes(term);
            const customerMatch = customer && `${customer.first_name} ${customer.last_name}`.toLowerCase().includes(term);

            return contentMatch || productMatch || customerMatch;
        }
        return true;
    });

    const handleUpdateStatus = async (review, newStatus) => {
        try {
            await db.reviews.update([activeAccount.id, review.id], { status: newStatus });
        } catch (error) {
            console.error("Failed to update review status", error);
            toast.error("Failed to update status");
        }
    };

    const handleDelete = async (review) => {
        if (confirm("Are you sure you want to delete this review?")) {
            await db.reviews.delete([activeAccount.id, review.id]);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'approved': return 'badge-success';
            case 'hold': return 'badge-warning'; // WooCommerce uses 'hold' often
            case 'pending': return 'badge-warning';
            case 'spam': return 'badge-danger';
            case 'trash': return 'badge-danger';
            default: return 'badge-secondary';
        }
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title">
                    <h1>Product Reviews</h1>
                    <p>Manage and moderate customer feedback across your store</p>
                </div>

                <div className="page-actions">
                    <div className="btn-group" style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px' }}>
                        {['all', 'approved', 'hold', 'spam'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilterStatus(f)}
                                className={`btn ${filterStatus === f ? 'btn-secondary' : 'btn-icon'}`}
                                style={{
                                    textTransform: 'capitalize',
                                    background: filterStatus === f ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    color: filterStatus === f ? 'var(--text-main)' : 'var(--text-muted)',
                                    borderRadius: '6px',
                                    fontSize: '0.85rem',
                                    padding: '0.4rem 0.8rem'
                                }}
                            >
                                {f}
                            </button>
                        ))}
                    </div>

                    <div style={{ position: 'relative', width: '250px' }}>
                        <input
                            type="text"
                            placeholder="Search reviews..."
                            className="input-field"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ paddingRight: '2rem' }}
                        />
                        <Search style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
                    </div>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
                {filteredReviews.length === 0 ? (
                    <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <MessageSquare size={48} style={{ opacity: 0.3, margin: '0 auto 1rem' }} />
                        <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>No reviews found</h3>
                        <p>Try adjusting filters or checking back later.</p>
                    </div>
                ) : (
                    <div className="reviews-list">
                        {filteredReviews.map((review) => {
                            const product = productMap[review.product_id];
                            const customer = customerMap[review.customer_id];

                            // Fallback to reviewer_name stored on the review object itself (for guests)
                            const reviewerName = customer
                                ? `${customer.first_name} ${customer.last_name}`
                                : (review.reviewer_name || 'Guest');

                            const reviewerInitial = reviewerName ? reviewerName[0] : '?';

                            return (
                                <div key={review.id} style={{
                                    padding: 'var(--spacing-md)',
                                    borderBottom: '1px solid var(--border-glass)',
                                    display: 'flex',
                                    gap: 'var(--spacing-md)',
                                    alignItems: 'flex-start'
                                }}>
                                    {/* Avatar Column */}
                                    <div style={{ flexShrink: 0 }}>
                                        <div style={{
                                            width: '40px', height: '40px', borderRadius: '50%',
                                            background: 'linear-gradient(135deg, #4f46e5, #ec4899)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: '#fff', fontWeight: 'bold'
                                        }}>
                                            {reviewerInitial}
                                        </div>
                                    </div>

                                    {/* Content Column */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                            <div>
                                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                                                    {reviewerName}
                                                    <span className={`badge ${getStatusBadge(review.status)}`} style={{ marginLeft: '10px', verticalAlign: 'middle' }}>
                                                        {review.status}
                                                    </span>
                                                </h4>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                    <div style={{ display: 'flex', color: '#f59e0b' }}>
                                                        {[1, 2, 3, 4, 5].map(star => (
                                                            <Star key={star} size={14} fill={star <= review.rating ? "currentColor" : "none"} strokeWidth={2} className={star > review.rating ? "text-slate-600" : ""} />
                                                        ))}
                                                    </div>
                                                    <span>•</span>
                                                    <span>{new Date(review.date_created).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <p style={{ color: 'var(--text-main)', lineHeight: '1.5', marginBottom: '0.75rem' }}>
                                            "{review.content}"
                                        </p>

                                        {product && (
                                            <div style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '4px',
                                                fontSize: '0.8rem', color: 'var(--text-muted)'
                                            }}>
                                                <Package size={12} />
                                                <span>Review for <strong>{product.name}</strong></span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions Column */}
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        {review.status !== 'approved' && (
                                            <button
                                                className="btn-icon"
                                                onClick={() => handleUpdateStatus(review, 'approved')}
                                                style={{ color: 'var(--success)', background: 'var(--success-bg)' }}
                                                title="Approve"
                                            >
                                                <CheckCircle size={18} />
                                            </button>
                                        )}
                                        {review.status === 'approved' && (
                                            <button
                                                className="btn-icon"
                                                onClick={() => handleUpdateStatus(review, 'pending')}
                                                style={{ color: 'var(--warning)', background: 'var(--warning-bg)' }}
                                                title="Unapprove"
                                            >
                                                <XCircle size={18} />
                                            </button>
                                        )}
                                        <button
                                            className="btn-icon"
                                            onClick={() => handleDelete(review)}
                                            style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}
                                            title="Delete"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReviewsPage;
