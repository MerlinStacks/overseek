import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import {
    Zap, Plus, Trash2, Power, Mail, Edit, Clock,
    GitBranch, Percent, Flag, CornerDownRight, XCircle, Tag, UserPlus, Send
} from 'lucide-react';
import { db } from '../db/db';
import { useSettings } from '../context/SettingsContext';
import { toast, Toaster } from 'sonner';
import './Automations.css';

const Automations = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const automations = useLiveQuery(() => db.automations.toArray()) || [];

    const handleDelete = async (id) => {
        if (window.confirm("Delete this automation?")) {
            await db.automations.delete(id);
            toast.success("Automation deleted");
        }
    };

    const handleToggle = async (aut) => {
        await db.automations.update(aut.id, { active: !aut.active });
        toast.success(`Automation ${!aut.active ? 'Enabled' : 'Disabled'}`);
    };

    // Helper to get icon for step type
    const getStepIcon = (step) => {
        if (step.type === 'wait') return <Clock size={12} />;
        if (step.type === 'condition') return <GitBranch size={12} />;
        if (step.type === 'split') return <Percent size={12} />;
        if (step.type === 'goal') return <Flag size={12} />;
        if (step.type === 'jump') return <CornerDownRight size={12} />;
        if (step.type === 'exit') return <XCircle size={12} />;
        if (step.subType === 'tag') return <Tag size={12} />;
        if (step.subType === 'user') return <UserPlus size={12} />;
        if (step.subType === 'webhook') return <Send size={12} />;
        return <Mail size={12} />;
    };

    const getStepColor = (step) => {
        if (step.type === 'wait') return '#fbbf24';
        if (step.type === 'condition') return '#f472b6';
        if (step.type === 'split') return '#818cf8';
        if (step.type === 'goal') return '#ef4444';
        if (step.type === 'jump' || step.type === 'exit') return '#9ca3af';
        if (step.subType === 'tag') return '#a78bfa';
        if (step.subType === 'user') return '#34d399';
        if (step.subType === 'webhook') return '#fbbf24';
        return '#60a5fa'; // email
    };

    return (
        <div className="automations-page p-8">
            <Toaster position="top-right" theme="dark" />

            <div className="automations-header">
                <div className="header-content">
                    <div className="automations-icon-wrapper">
                        <Zap size={32} />
                    </div>
                    <div className="automations-title">
                        <h2>Email Flows & Automations</h2>
                        <p>Create automated email sequences to engage customers.</p>
                    </div>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/automations/new')}>
                    <Plus size={18} style={{ marginRight: '6px' }} /> Create Flow
                </button>
            </div>

            <div className="glass-panel" style={{ marginTop: '2rem' }}>
                <table className="automations-table">
                    <thead>
                        <tr>
                            <th>Status</th>
                            <th>Name</th>
                            <th>Trigger</th>
                            <th>Flow Preview</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {automations.map(aut => (
                            <tr key={aut.id}>
                                <td data-label="Status">
                                    <span className="mobile-label">Status:</span>
                                    <button
                                        className={`status-toggle ${aut.active ? 'active' : ''}`}
                                        onClick={() => handleToggle(aut)}
                                    >
                                        <Power size={14} />
                                    </button>
                                </td>
                                <td data-label="Name" style={{ fontWeight: 500 }}>
                                    <span className="mobile-label">Name:</span>
                                    {aut.name}
                                </td>
                                <td data-label="Trigger">
                                    <span className="mobile-label">Trigger:</span>
                                    <div className="chip">
                                        <Zap size={12} style={{ marginRight: '6px' }} />
                                        {aut.trigger_type ? aut.trigger_type.replace(/_/g, ' ') : 'Manual Trigger'}
                                    </div>
                                </td>
                                <td data-label="Flow Preview">
                                    <span className="mobile-label">Preview:</span>
                                    {aut.steps && aut.steps.length > 0 ? (
                                        <div className="flow-meta-info">
                                            <div className="flow-preview-stack -space-x-2">
                                                {aut.steps.slice(0, 5).map((s, i) => (
                                                    <div
                                                        key={i}
                                                        title={`${s.type} ${s.label || ''}`}
                                                        style={{
                                                            width: 28,
                                                            height: 28,
                                                            borderRadius: '50%',
                                                            background: getStepColor(s),
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            color: '#1e293b', // Dark text for contrast against bright colors
                                                            fontSize: '12px',
                                                            border: '2px solid #1e293b',
                                                            zIndex: 10 - i,
                                                            position: 'relative'
                                                        }}
                                                    >
                                                        {getStepIcon(s)}
                                                    </div>
                                                ))}
                                                {aut.steps.length > 5 && (
                                                    <div style={{
                                                        width: 28, height: 28, borderRadius: '50%',
                                                        background: '#334155', color: '#e2e8f0',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '10px',
                                                        border: '2px solid #1e293b',
                                                        zIndex: 0,
                                                        position: 'relative',
                                                        marginLeft: '-8px'
                                                    }}>
                                                        +{aut.steps.length - 5}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="meta-item">
                                                <Clock size={14} />
                                                <span>{aut.steps.length} Steps</span>
                                            </div>
                                            <div className="meta-item">
                                                <UserPlus size={14} />
                                                <span>- Active</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-muted text-small">Draft (No steps)</span>
                                    )}
                                </td>
                                <td data-label="Actions">
                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        <button className="btn-icon" onClick={() => navigate(`/automations/${aut.id}`)}>
                                            <Edit size={16} />
                                        </button>
                                        <button className="btn-icon danger" onClick={() => handleDelete(aut.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {automations.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                    No automations yet. Create one to get started!
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Automations;
