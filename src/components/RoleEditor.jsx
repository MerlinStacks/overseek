import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { Plus, Trash2, Save, X, Shield, Check } from 'lucide-react';
import { toast } from 'sonner';

const PERMISSIONS_LIST = [
    { id: 'view_dashboard', label: 'View Dashboard', description: 'Access to the home dashboard' },
    { id: 'view_orders', label: 'View Orders', description: 'See order list and details' },
    { id: 'edit_orders', label: 'Edit Orders', description: 'Update order status and add notes' },
    { id: 'view_products', label: 'View Products', description: 'See product list and details' },
    { id: 'edit_products', label: 'Edit Products', description: 'Update product prices and stock' },
    { id: 'view_customers', label: 'View Customers', description: 'Access customer database' },
    { id: 'view_analytics', label: 'View Analytics', description: 'See sales reports and stats' },
    { id: 'view_settings', label: 'Access Settings', description: 'Configure store settings (Critical)' },
    { id: 'view_users', label: 'Manage Users', description: 'Create and edit users/roles (Critical)' },
];

const RoleEditor = () => {
    const [roles, setRoles] = useState([]);
    const [editingRole, setEditingRole] = useState(null); // The role object being edited
    const [isCreating, setIsCreating] = useState(false);
    const [formData, setFormData] = useState({ name: '', permissions: [] });

    const loadRoles = async () => {
        try {
            const data = await db.roles.toArray();
            setRoles(data);
        } catch (error) {
            console.error(error);
            toast.error("Failed to load roles");
        }
    };

    useEffect(() => {
        loadRoles();
    }, []);

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            if (editingRole) {
                await db.roles.update(editingRole.id, formData);
                toast.success("Role updated");
            } else {
                await db.roles.add(formData);
                toast.success("Role created");
            }
            closeForm();
            loadRoles();
        } catch (error) {
            console.error(error);
            toast.error("Failed to save role");
        }
    };

    const deleteRole = async (id) => {
        if (!window.confirm("Are you sure? Users with this role may lose access.")) return;
        try {
            await db.roles.delete(id);
            toast.success("Role deleted");
            loadRoles();
        } catch (error) {
            console.error(error);
            toast.error("Failed to delete role");
        }
    };

    const startEdit = (role) => {
        setEditingRole(role);
        setFormData({ name: role.name, permissions: role.permissions || [] });
        setIsCreating(true);
    };

    const startCreate = () => {
        setEditingRole(null);
        setFormData({ name: '', permissions: [] });
        setIsCreating(true);
    };

    const closeForm = () => {
        setIsCreating(false);
        setEditingRole(null);
    };

    const togglePermission = (permId) => {
        setFormData(prev => {
            if (permId === '*') {
                // Toggle admin access
                if (prev.permissions.includes('*')) return { ...prev, permissions: [] };
                return { ...prev, permissions: ['*'] };
            }

            // If currently Super Admin (*), clear it first
            let newPerms = prev.permissions.filter(p => p !== '*');

            if (newPerms.includes(permId)) {
                return { ...prev, permissions: newPerms.filter(p => p !== permId) };
            } else {
                return { ...prev, permissions: [...newPerms, permId] };
            }
        });
    };

    return (
        <div className="role-editor fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3>Roles & Permissions</h3>
                <button onClick={startCreate} className="btn btn-primary">
                    <Plus size={16} /> New Role
                </button>
            </div>

            <div className="roles-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
                {roles.map(role => (
                    <div key={role.id} className="glass-panel" style={{ padding: '20px', position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
                            <div>
                                <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{role.name}</h4>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {(role.permissions || []).includes('*') ? 'Super Admin Access' : `${(role.permissions || []).length} Permissions`}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={() => startEdit(role)} className="btn-icon">
                                    <Shield size={16} />
                                </button>
                                {role.name !== 'Admin' && (
                                    <button onClick={() => deleteRole(role.id)} className="btn-icon" style={{ color: '#ef4444' }}>
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {(role.permissions || []).includes('*') ? (
                                <span className="badge" style={{ background: '#ec4899', color: 'white' }}>ALL ACCESS</span>
                            ) : (
                                (role.permissions || []).slice(0, 5).map(p => (
                                    <span key={p} className="badge" style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                                        {p.replace('_', ' ')}
                                    </span>
                                ))
                            )}
                            {((role.permissions || []).length > 5 && !(role.permissions || []).includes('*')) && (
                                <span className="badge" style={{ fontSize: '0.7rem' }}>+{(role.permissions.length - 5)} more</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {isCreating && (
                <div className="modal-overlay">
                    <div className="modal-content glass-panel" style={{ maxWidth: '600px', width: '100%' }}>
                        <div className="modal-header">
                            <h3>{editingRole ? 'Edit Role' : 'Create Role'}</h3>
                            <button onClick={closeForm} className="btn-icon"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSave}>
                            <div className="form-group">
                                <label className="form-label">Role Name</label>
                                <input
                                    className="form-input"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    required
                                    placeholder="e.g. Warehouse Packer"
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Permissions</label>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '10px',
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    paddingRight: '5px'
                                }}>
                                    <div
                                        className={`permission-item ${formData.permissions.includes('*') ? 'active' : ''}`}
                                        onClick={() => togglePermission('*')}
                                        style={{
                                            padding: '10px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--border-glass)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gridColumn: 'span 2',
                                            background: formData.permissions.includes('*') ? 'rgba(236, 72, 153, 0.2)' : 'transparent',
                                            borderColor: formData.permissions.includes('*') ? '#ec4899' : 'var(--border-glass)'
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 600 }}>Super Admin (All Access)</div>
                                            <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Full system control. Overrides all other permissions.</div>
                                        </div>
                                        {formData.permissions.includes('*') && <Check size={18} color="#ec4899" />}
                                    </div>

                                    {PERMISSIONS_LIST.map(perm => (
                                        <div
                                            key={perm.id}
                                            className={`permission-item ${formData.permissions.includes(perm.id) ? 'active' : ''}`}
                                            onClick={() => togglePermission(perm.id)}
                                            style={{
                                                padding: '10px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--border-glass)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                background: formData.permissions.includes(perm.id) ? 'var(--primary-light)' : 'transparent',
                                                borderColor: formData.permissions.includes(perm.id) ? 'var(--primary)' : 'var(--border-glass)',
                                                opacity: formData.permissions.includes('*') ? 0.5 : 1,
                                                pointerEvents: formData.permissions.includes('*') ? 'none' : 'auto'
                                            }}
                                        >
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{perm.label}</div>
                                                <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{perm.description}</div>
                                            </div>
                                            {formData.permissions.includes(perm.id) && <Check size={16} color="var(--primary)" />}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '20px', display: 'flex', gap: '10px' }}>
                                <button type="button" onClick={closeForm} className="btn">Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Role</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RoleEditor;
