import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Users, Search, Plus, Trash2, Mail, Phone, Globe, Edit2, X } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import './Inventory.css';

const Suppliers = () => {
    const suppliers = useLiveQuery(() => db.suppliers.toArray()) || [];
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);

    const filtered = suppliers.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.contact_person?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleDelete = async (id) => {
        if (confirm('Delete this supplier?')) {
            await db.suppliers.delete(id);
            toast.success('Supplier deleted');
        }
    };

    return (
        <div className="inventory-page">
            <Toaster position="top-right" theme="dark" />

            <div className="inventory-header">
                <div className="header-content">
                    <div className="inventory-icon-wrapper" style={{ color: 'var(--success)', background: 'rgba(16, 185, 129, 0.2)' }}>
                        <Users size={32} />
                    </div>
                    <div className="inventory-title">
                        <h2>Suppliers</h2>
                        <p>Manage your product sources and vendors.</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div className="input-wrapper" style={{ width: '250px' }}>
                        <input
                            className="form-input"
                            style={{ width: '100%' }}
                            placeholder="Search suppliers..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <Search className="input-icon" size={18} />
                    </div>
                    <button
                        onClick={() => { setEditingSupplier(null); setIsModalOpen(true); }}
                        className="btn btn-primary"
                    >
                        <Plus size={16} /> Add Supplier
                    </button>
                </div>
            </div>

            <div className="glass-panel inventory-table-container">
                <table className="inventory-table">
                    <thead>
                        <tr>
                            <th>Supplier Name</th>
                            <th>Contact Person</th>
                            <th>Contact Info</th>
                            <th>Lead Time</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(supplier => (
                            <tr key={supplier.id}>
                                <td>
                                    <div style={{ fontWeight: 600 }}>{supplier.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: #{supplier.id}</div>
                                </td>
                                <td>
                                    {supplier.contact_person ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Users size={14} className="text-muted" /> {supplier.contact_person}
                                        </div>
                                    ) : <span className="text-muted">-</span>}
                                </td>
                                <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.85rem' }}>
                                        {supplier.email && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Mail size={12} className="text-muted" />
                                                <a href={`mailto:${supplier.email}`} style={{ color: 'var(--primary)' }}>{supplier.email}</a>
                                            </div>
                                        )}
                                        {supplier.phone && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Phone size={12} className="text-muted" /> {supplier.phone}
                                            </div>
                                        )}
                                        {supplier.website && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Globe size={12} className="text-muted" />
                                                <a href={supplier.website} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>{supplier.website}</a>
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    {(supplier.lead_time_min || supplier.lead_time_max) ? (
                                        <div className="status-badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.2)', width: 'fit-content' }}>
                                            {supplier.lead_time_min || '?'} - {supplier.lead_time_max || '?'} Days
                                        </div>
                                    ) : <span className="text-muted text-xs">Not set</span>}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        <button
                                            onClick={() => { setEditingSupplier(supplier); setIsModalOpen(true); }}
                                            className="btn"
                                            style={{ padding: '6px', background: 'transparent', color: 'var(--text-muted)' }}
                                            title="Edit"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(supplier.id)}
                                            className="btn"
                                            style={{ padding: '6px', background: 'transparent', color: 'var(--danger)' }}
                                            title="Delete"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 && (
                            <tr><td colSpan="4" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No suppliers found. Add your first one.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <SupplierModal
                    supplier={editingSupplier}
                    onClose={() => setIsModalOpen(false)}
                />
            )}
        </div>
    );
};

const SupplierModal = ({ supplier, onClose }) => {
    const [formData, setFormData] = useState(supplier || {
        name: '',
        contact_person: '',
        email: '',
        phone: '',
        website: '',
        address: ''
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (supplier?.id) {
                await db.suppliers.update(supplier.id, formData);
                toast.success('Supplier updated');
            } else {
                await db.suppliers.add(formData);
                toast.success('Supplier added');
            }
            onClose();
        } catch (error) {
            console.error(error);
            toast.error('Failed to save supplier');
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '400px' }}>
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                        <h2 className="modal-title">{supplier ? 'Edit Supplier' : 'New Supplier'}</h2>
                        <p className="modal-desc">Manage supplier details and lead times.</p>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="form-group">
                        <label className="input-label">Company Name *</label>
                        <input
                            required
                            className="form-input"
                            style={{ width: '100%' }}
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label className="input-label">Contact Person</label>
                            <input
                                className="form-input"
                                style={{ width: '100%' }}
                                value={formData.contact_person}
                                onChange={e => setFormData({ ...formData, contact_person: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label className="input-label">Email</label>
                            <input
                                type="email"
                                className="form-input"
                                style={{ width: '100%' }}
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div className="form-group">
                            <label className="input-label">Phone</label>
                            <input
                                className="form-input"
                                style={{ width: '100%' }}
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <label className="input-label">Website</label>
                            <input
                                className="form-input"
                                style={{ width: '100%' }}
                                value={formData.website}
                                onChange={e => setFormData({ ...formData, website: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="input-label">Address</label>
                        <textarea
                            className="form-input"
                            style={{ width: '100%', height: '80px', resize: 'none' }}
                            value={formData.address}
                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                        />
                    </div>

                    {/* Lead Time Range */}
                    <div className="form-group">
                        <label className="input-label">Lead Time Range (Days)</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                                type="number"
                                min="0"
                                className="form-input"
                                style={{ flex: 1 }}
                                placeholder="Min"
                                value={formData.lead_time_min || ''}
                                onChange={e => setFormData({ ...formData, lead_time_min: e.target.value })}
                            />
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                            <input
                                type="number"
                                min="0"
                                className="form-input"
                                style={{ flex: 1 }}
                                placeholder="Max"
                                value={formData.lead_time_max || ''}
                                onChange={e => setFormData({ ...formData, lead_time_max: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" onClick={onClose} className="btn" style={{ background: 'transparent' }}>Cancel</button>
                        <button type="submit" className="btn btn-primary">Save Supplier</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Suppliers;
