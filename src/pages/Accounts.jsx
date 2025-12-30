import React, { useState } from 'react';
import { useAccount } from '../context/AccountContext';
import { Plus, Globe, Server, User, Settings as SettingsIcon, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import './Accounts.css';

const AccountsPage = () => {
    const { accounts, activeAccount, switchAccount, createAccount } = useAccount();
    const [isCreating, setIsCreating] = useState(false);
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountDomain, setNewAccountDomain] = useState('');
    const [editingAccount, setEditingAccount] = useState(null); // Account being edited
    const navigate = useNavigate();

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            const acc = await createAccount(newAccountName, newAccountDomain);
            setIsCreating(false);
            setNewAccountName('');
            setNewAccountDomain('');
            switchAccount(acc.id); // Auto switch
        } catch (error) {
            console.error(error);
            alert('Failed to create account');
        }
    };

    const toggleFeature = async (accountId, featureKey) => {
        const account = accounts.find(a => a.id === accountId);
        if (!account) return;

        const features = account.features || {};
        const newValue = !features[featureKey];

        await db.table('accounts').update(accountId, {
            features: { ...features, [featureKey]: newValue }
        });
        // We rely on useAccount to re-fetch or live query, but AccountContext might need refresh.
        // Assuming AccountContext uses useLiveQuery for 'accounts', it will auto-update.
    };

    return (
        <div className="accounts-container">
            <div className="accounts-header">
                <div className="accounts-title">
                    <h1>Account Management</h1>
                    <p>Manage your organizations and sites.</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="btn-create"
                >
                    <Plus size={18} />
                    New Account
                </button>
            </div>

            {/* Create Modal/Form (Inline for now) */}
            {isCreating && (
                <div className="create-account-panel">
                    <h3>Create New Tenant</h3>
                    <form onSubmit={handleCreate}>
                        <div className="form-group">
                            <label>Account Name</label>
                            <input
                                type="text"
                                value={newAccountName}
                                onChange={e => setNewAccountName(e.target.value)}
                                className="form-input"
                                placeholder="e.g. Client A Store"
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>Domain / URL</label>
                            <input
                                type="text"
                                value={newAccountDomain}
                                onChange={e => setNewAccountDomain(e.target.value)}
                                className="form-input"
                                placeholder="e.g. client-a.com"
                            />
                        </div>
                        <div className="form-actions">
                            <button type="submit" className="btn-submit">
                                Create & Switch
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsCreating(false)}
                                className="btn-cancel"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Features Modal */}
            {editingAccount && (
                <div className="create-account-panel">
                    <h3>Manage Features: {editingAccount.name}</h3>
                    <div className="features-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '20px 0' }}>

                        <div className="feature-item glass-panel" style={{ padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h4 style={{ margin: 0, marginBottom: '5px' }}>Ad Revenue Tracking & AI</h4>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    Enable Meta/Google Ads tracking and AI performance suggestions.
                                </p>
                            </div>
                            <button
                                className={`btn-icon ${editingAccount.features?.adRevenueTracking ? 'success' : ''}`}
                                onClick={() => toggleFeature(editingAccount.id, 'adRevenueTracking')}
                                style={{
                                    width: '40px', height: '24px',
                                    borderRadius: '12px',
                                    background: editingAccount.features?.adRevenueTracking ? '#10b981' : '#334155',
                                    position: 'relative',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <div style={{
                                    width: '18px', height: '18px',
                                    background: 'white',
                                    borderRadius: '50%',
                                    position: 'absolute',
                                    top: '3px',
                                    left: editingAccount.features?.adRevenueTracking ? '19px' : '3px',
                                    transition: 'all 0.2s'
                                }} />
                            </button>
                        </div>
                        {/* More features can go here */}

                    </div>
                    <button
                        onClick={() => setEditingAccount(null)}
                        className="btn-cancel"
                        style={{ width: '100%' }}
                    >
                        Close
                    </button>
                </div>
            )}

            <div className="accounts-grid">
                {accounts.map(account => {
                    const isActive = activeAccount?.id === account.id;
                    return (
                        <div
                            key={account.id}
                            className={`account-card ${isActive ? 'active' : ''}`}
                        >
                            <div className="card-header">
                                <div className="icon-box">
                                    <Server size={24} />
                                </div>
                                {isActive && (
                                    <div className="status-badge">
                                        <div className="pulse-dot" />
                                        ACTIVE
                                    </div>
                                )}
                            </div>

                            <h3 className="account-name">{account.name}</h3>
                            <div className="account-domain">
                                <Globe size={14} />
                                {account.domain || 'No domain configured'}
                            </div>

                            <div className="card-footer">
                                <button
                                    onClick={() => switchAccount(account.id)}
                                    disabled={isActive}
                                    className={`btn-switch ${isActive ? 'current' : ''}`}
                                >
                                    {isActive ? 'Current Session' : 'Switch to Account'}
                                </button>
                                <button
                                    onClick={() => setEditingAccount(account)}
                                    className="btn-config"
                                    title="Manage Features"
                                >
                                    <SettingsIcon size={18} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AccountsPage;
