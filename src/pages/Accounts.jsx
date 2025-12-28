import React, { useState } from 'react';
import { useAccount } from '../context/AccountContext';
import { Plus, Globe, Server, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Accounts.css';

const AccountsPage = () => {
    const { accounts, activeAccount, switchAccount, createAccount } = useAccount();
    const [isCreating, setIsCreating] = useState(false);
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountDomain, setNewAccountDomain] = useState('');
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
                                    onClick={() => navigate('/settings')}
                                    className="btn-config"
                                    title="Configure"
                                >
                                    <User size={18} />
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
