import React, { useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { Plus, Globe, Server, User, Database, MoreVertical, ShieldCheck, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import '../../layouts/AdminLayout.css'; // Use shared admin styles

const AdminAccountsPage = () => {
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
        <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>Organization Tenants</h1>
                    <p style={{ color: 'var(--text-muted)' }}>Manage multi-tenant isolation and configurations.</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.75rem 1.5rem', borderRadius: '8px' }}
                >
                    <Plus size={18} />
                    Provision New Tenant
                </button>
            </div>

            {/* Create Modal - Keeping simple inline for now */}
            {isCreating && (
                <div className="admin-card" style={{ marginBottom: '2rem', padding: '2rem', maxWidth: '600px', border: '1px solid #10b981' }}>
                    <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', fontWeight: 'bold' }}>New Tenant Configuration</h3>
                    <form onSubmit={handleCreate}>
                        <div style={{ display: 'grid', gap: '1rem' }}>
                            <div>
                                <label className="form-label">Tenant Name</label>
                                <input
                                    type="text"
                                    value={newAccountName}
                                    onChange={e => setNewAccountName(e.target.value)}
                                    className="form-input"
                                    placeholder="e.g. Enterprise Client A"
                                    required
                                />
                            </div>
                            <div>
                                <label className="form-label">Domain Binding (Optional)</label>
                                <input
                                    type="text"
                                    value={newAccountDomain}
                                    onChange={e => setNewAccountDomain(e.target.value)}
                                    className="form-input"
                                    placeholder="e.g. store.client-a.com"
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                <button type="submit" className="btn btn-primary">Provision Tenant</button>
                                <button type="button" onClick={() => setIsCreating(false)} className="btn btn-secondary">Cancel</button>
                            </div>
                        </div>
                    </form>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
                {accounts.map(account => {
                    const isActive = activeAccount?.id === account.id;
                    return (
                        <div
                            key={account.id}
                            className="admin-card"
                            style={{
                                padding: '1.5rem',
                                position: 'relative',
                                borderColor: isActive ? '#3b82f6' : 'rgba(255,255,255,0.05)',
                                background: isActive ? 'rgba(59, 130, 246, 0.05)' : undefined
                            }}
                        >
                            {isActive && (
                                <div style={{ position: 'absolute', top: '1rem', right: '1rem', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#3b82f6', fontWeight: 600 }}>
                                    <span style={{ width: '6px', height: '6px', background: '#3b82f6', borderRadius: '50%', boxShadow: '0 0 8px #3b82f6' }} />
                                    CURRENT SESSION
                                </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                                <div style={{
                                    width: '48px', height: '48px',
                                    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                                    borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                }}>
                                    <Server size={24} color={isActive ? '#3b82f6' : '#94a3b8'} />
                                </div>
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{account.name}</h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        <Globe size={12} />
                                        {account.domain || 'Local Environment'}
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem',
                                borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)',
                                padding: '1rem 0', marginBottom: '1.5rem'
                            }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>DB SIZE</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                                        <Database size={14} color="#10b981" />
                                        <span>-</span>
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>LAST SYNC</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                                        <RefreshCw size={14} color="#f59e0b" />
                                        <span>-</span>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button
                                    onClick={() => switchAccount(account.id)}
                                    disabled={isActive}
                                    style={{
                                        flex: 1, padding: '0.75rem', borderRadius: '8px', border: 'none', fontWeight: 600, cursor: isActive ? 'default' : 'pointer',
                                        background: isActive ? 'rgba(59, 130, 246, 0.2)' : '#3b82f6',
                                        color: isActive ? '#3b82f6' : 'white',
                                        opacity: isActive ? 0.8 : 1
                                    }}
                                >
                                    {isActive ? 'Active' : 'Switch Context'}
                                </button>
                                <button
                                    onClick={() => navigate('/settings')}
                                    style={{
                                        width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '8px', cursor: 'pointer', color: 'var(--text-muted)'
                                    }}
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

export default AdminAccountsPage;
