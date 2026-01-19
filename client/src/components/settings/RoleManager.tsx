'use client';

import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { usePermissions } from '../../hooks/usePermissions';
import { useUser } from '../../hooks/useUser';
import { Plus, Trash2, Edit2, Check, X, Shield } from 'lucide-react';

interface Role {
    id: string;
    name: string;
    permissions: Record<string, boolean>;
    _count: { users: number };
}

const AVAILABLE_PERMISSIONS = [
    { key: 'view_products', label: 'View Products' },
    { key: 'edit_products', label: 'Edit Products' },
    { key: 'view_orders', label: 'View Orders' },
    { key: 'edit_orders', label: 'Edit Orders (General)' },
    { key: 'edit_order_tags', label: 'Edit Order Tags' },
    { key: 'view_finance', label: 'View Finance & Analytics' },
    { key: 'view_marketing', label: 'View Marketing & AI' },
    { key: 'manage_roles', label: 'Manage Roles & Team' },
];

export default function RoleManager() {
    const { hasPermission } = usePermissions();
    const { user } = useUser(); // Need accountId ideally or fetch wrapper handles it
    const [roles, setRoles] = useState<Role[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [currentRole, setCurrentRole] = useState<Partial<Role>>({});

    const fetchRoles = async () => {
        try {
            const res = await fetch('/api/roles', {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'x-account-id': localStorage.getItem('accountId') || '' }
            });
            if (res.ok) {
                const data = await res.json();
                setRoles(data);
            }
        } catch (e) {
            Logger.error('Failed to fetch roles', { error: e });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRoles();
    }, []);

    const handleSave = async () => {
        // Client-side validation
        if (!currentRole.name || currentRole.name.trim() === '') {
            alert('Role name is required');
            return;
        }

        try {
            const method = currentRole.id ? 'PUT' : 'POST';
            const url = currentRole.id ? `/api/roles/${currentRole.id}` : '/api/roles';

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'x-account-id': localStorage.getItem('accountId') || ''
                },
                body: JSON.stringify({
                    name: currentRole.name.trim(),
                    permissions: currentRole.permissions || {}
                })
            });

            if (res.ok) {
                setIsEditing(false);
                setCurrentRole({});
                fetchRoles();
            } else {
                const errorData = await res.json().catch(() => ({ error: 'Failed to save role' }));
                alert(errorData.error || 'Failed to save role');
            }
        } catch (e) {
            Logger.error('Error saving role', { error: e });
            alert('Error saving role');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure? This will remove the role from all assigned users.')) return;

        try {
            const res = await fetch(`/api/roles/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'x-account-id': localStorage.getItem('accountId') || ''
                }
            });
            if (res.ok) fetchRoles();
        } catch (e) {
            alert('Error deleting role');
        }
    };

    if (isLoading) return <div>Loading roles...</div>;
    if (!hasPermission('manage_roles') && !hasPermission('*')) return <div>You do not have permission to manage roles.</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold flex items-center gap-2"><Shield className="w-5 h-5" /> Roles & Permissions</h2>
                <button
                    onClick={() => { setCurrentRole({ permissions: {} }); setIsEditing(true); }}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                    <Plus className="w-4 h-4" /> Create Role
                </button>
            </div>

            {isEditing && (
                <div className="bg-white/5 border border-white/10 p-6 rounded-xl space-y-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium mb-1">Role Name</label>
                        <input
                            type="text"
                            value={currentRole.name || ''}
                            onChange={e => setCurrentRole({ ...currentRole, name: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded px-3 py-2"
                            placeholder="e.g. Packing Staff"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {AVAILABLE_PERMISSIONS.map(p => (
                            <label key={p.key} className="flex items-center gap-3 p-3 bg-white/5 rounded cursor-pointer hover:bg-white/10">
                                <input
                                    type="checkbox"
                                    checked={!!currentRole.permissions?.[p.key]}
                                    onChange={e => {
                                        const newPerms = { ...currentRole.permissions };
                                        if (e.target.checked) newPerms[p.key] = true;
                                        else delete newPerms[p.key];
                                        setCurrentRole({ ...currentRole, permissions: newPerms });
                                    }}
                                    className="w-4 h-4 rounded border-gray-500 bg-transparent"
                                />
                                <span>{p.label}</span>
                            </label>
                        ))}
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <button onClick={() => setIsEditing(false)} className="px-4 py-2 hover:bg-white/10 rounded">Cancel</button>
                        <button onClick={handleSave} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded">Save Role</button>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4">
                {roles.map(role => (
                    <div key={role.id} className="bg-white/5 border border-white/10 p-4 rounded-xl flex justify-between items-center group">
                        <div>
                            <h3 className="font-bold text-lg">{role.name}</h3>
                            <p className="text-sm text-gray-400">{role._count?.users || 0} users assigned</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {Object.keys(role.permissions).map(key => (
                                    <span key={key} className="text-xs bg-white/10 px-2 py-1 rounded text-gray-300">
                                        {AVAILABLE_PERMISSIONS.find(p => p.key === key)?.label || key}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition">
                            <button onClick={() => { setCurrentRole(role); setIsEditing(true); }} className="p-2 hover:bg-blue-500/20 text-blue-400 rounded">
                                <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(role.id)} className="p-2 hover:bg-red-500/20 text-red-400 rounded">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}

                {roles.length === 0 && !isEditing && (
                    <div className="text-center py-10 text-gray-500">
                        No custom roles defined.
                    </div>
                )}
            </div>
        </div>
    );
}
