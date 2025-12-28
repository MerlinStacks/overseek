import React, { useState, useEffect } from 'react';
import { Users, Plus, Shield, Mail, Trash2, RefreshCw, Pencil, X, Layout } from 'lucide-react';
import { db } from '../db/db';
import { useAuth } from '../context/AuthContext';
import md5 from 'md5';
import { toast, Toaster } from 'sonner';
import RoleEditor from '../components/RoleEditor';
import './Users.css';

const UsersPage = () => {
    const { user: currentUser } = useAuth();
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState([]);
    const [availableRoles, setAvailableRoles] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // New User Form
    const [newUser, setNewUser] = useState({
        username: '',
        name: '',
        password: '',
        role: 'Staff' // Default
    });

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [usersData, rolesData] = await Promise.all([
                db.dashboard_users.toArray(),
                db.roles.toArray()
            ]);
            setUsers(usersData);
            setAvailableRoles(rolesData);

            // Set default role for new user if not set
            if (rolesData.length > 0 && !newUser.role) {
                setNewUser(prev => ({ ...prev, role: rolesData[0].name }));
            }
        } catch (error) {
            console.error(error);
            toast.error("Failed to fetch data.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            if (editingId) {
                const updates = {
                    name: newUser.name,
                    username: newUser.username,
                    role: newUser.role
                };
                if (newUser.password) updates.password = newUser.password;

                await db.dashboard_users.update(editingId, updates);
                toast.success("User updated!");
            } else {
                await db.dashboard_users.add({
                    ...newUser,
                    avatar: ''
                });
                toast.success(`User ${newUser.username} created!`);
            }
            closeForm();
            loadData();
        } catch (error) {
            console.error(error);
            toast.error("Failed to save user.");
        } finally {
            setIsLoading(false);
        }
    };

    const closeForm = () => {
        setIsCreating(false);
        setEditingId(null);
        setNewUser({ username: '', name: '', password: '', role: availableRoles[0]?.name || 'Staff' });
    };

    const startEdit = (user) => {
        setNewUser({
            username: user.username,
            name: user.name,
            role: user.role,
            password: ''
        });
        setEditingId(user.id);
        setIsCreating(true);
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this user?")) return;
        try {
            await db.dashboard_users.delete(id);
            toast.success("User deleted");
            setUsers(prev => prev.filter(u => u.id !== id));
        } catch (error) {
            console.error(error);
            toast.error("Failed to delete user");
        }
    };

    return (
        <div className="users-page">
            <Toaster position="top-right" theme="dark" />

            <div className="users-header">
                <div className="header-left">
                    <div className="header-icon">
                        <Users size={32} />
                    </div>
                    <div>
                        <h2>Access Control</h2>
                        <p>Manage users and their permissions</p>
                    </div>
                </div>
                <div className="header-actions">
                    <div className="tabs-pill">
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
                        >
                            Users
                        </button>
                        <button
                            onClick={() => setActiveTab('roles')}
                            className={`tab-btn ${activeTab === 'roles' ? 'active' : ''}`}
                        >
                            Roles & Permissions
                        </button>
                    </div>

                    {activeTab === 'users' && (
                        <button onClick={() => setIsCreating(true)} className="btn btn-primary"><Plus size={18} /> Add User</button>
                    )}
                </div>
            </div>

            {/* TAB CONTENT */}

            {activeTab === 'roles' && <RoleEditor />}

            {activeTab === 'users' && (
                <>
                    {/* User Grid */}
                    <div className="users-grid">
                        {users.map(user => (
                            <div key={user.id} className="glass-card user-card">
                                <div className="user-card-header">
                                    <div className="user-info">
                                        <img
                                            src={`https://www.gravatar.com/avatar/${md5(user.username)}?d=retro`}
                                            className="user-avatar"
                                            alt="avatar"
                                        />
                                        <div className="user-info-text">
                                            <h4 className="user-name">{user.name}</h4>
                                            <p className="user-username">@{user.username}</p>
                                        </div>
                                    </div>
                                    <span className={`user-role-badge role-${user.role.toLowerCase()}`}>
                                        {user.role}
                                    </span>
                                </div>
                                <div className="user-details">
                                    <div className="detail-item">
                                        <Shield size={14} /> Local Dashboard Access
                                    </div>
                                </div>
                                {currentUser && (currentUser.role === 'Admin' || currentUser.role === 'admin' || user.username === currentUser.username) && (
                                    <div className="user-card-actions">
                                        <button onClick={() => startEdit(user)} className="btn-icon" title="Edit User">
                                            <Pencil size={16} />
                                        </button>
                                        {user.username !== 'admin' && user.id !== currentUser.id && (
                                            <button onClick={() => handleDelete(user.id)} className="btn-icon btn-icon-danger" title="Delete User">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Modal for User Creation */}
                    {isCreating && (
                        <div className="modal-overlay">
                            <div className="modal-content" style={{ maxWidth: '500px' }}>
                                <div className="modal-header">
                                    <h3>{editingId ? 'Edit User' : 'Add User'}</h3>
                                    <button onClick={closeForm} className="btn-icon"><X size={20} /></button>
                                </div>
                                <form onSubmit={handleSubmit} className="form-stack">
                                    <div className="form-group">
                                        <label className="input-label">Username</label>
                                        <input className="form-input" required value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="input-label">Display Name</label>
                                        <input className="form-input" required value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="input-label">Password {editingId && <span className="text-muted text-sm">(Blank to keep)</span>}</label>
                                        <input className="form-input" type="password" required={!editingId} value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <label className="input-label">Role</label>
                                        <select className="form-input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                                            {availableRoles.map(role => (
                                                <option key={role.id} value={role.name}>{role.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="modal-footer">
                                        <button type="button" onClick={closeForm} className="btn">Cancel</button>
                                        <button type="submit" className="btn btn-primary" disabled={isLoading}>
                                            {editingId ? 'Save Changes' : 'Create User'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default UsersPage;
