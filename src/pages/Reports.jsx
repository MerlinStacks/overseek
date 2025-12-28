import React, { useState, useEffect } from 'react';
import { Mail, Slack, Plus, Trash2, Clock, BarChart2, CheckCircle, Send, FileText, Eye, X, PackageX } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { useSettings } from '../context/SettingsContext';
import { sendEmail } from '../services/api';
import { db } from '../db/db';
import CustomReportBuilder from '../components/CustomReportBuilder';
import DOMPurify from 'dompurify';
import './Reports.css';

import { useLiveQuery } from 'dexie-react-hooks';

import { generatePDF, generateCSV, generateDigestHTML } from '../services/reportService';

// ... (imports)

const Reports = () => {
    const { settings } = useSettings();

    // Fetch reports from DB
    const reports = useLiveQuery(() => db.reports.toArray()) || [];

    const [activeTab, setActiveTab] = useState('generate'); // 'generate' | 'digests'
    const [reportType, setReportType] = useState('sales');
    const [dateRange, setDateRange] = useState({ label: 'Last 30 Days', days: 30 });

    // State for Digests (restored)
    const [isCreating, setIsCreating] = useState(false);
    const [newReport, setNewReport] = useState({ title: '', frequency: 'Daily', time: '09:00', channels: [], metrics: [] });
    const [previewHtml, setPreviewHtml] = useState(null);
    const [isPreviewing, setIsPreviewing] = useState(false);

    // PDF Generation
    const downloadPDF = async () => {
        const toastId = toast.loading("Generating PDF...");
        try {
            await generatePDF(reportType, dateRange);
            toast.success("PDF Downloaded", { id: toastId });
        } catch (e) {
            console.error(e);
            toast.error("Failed to generate PDF", { id: toastId });
        }
    };

    // CSV Generation
    const downloadCSV = async () => {
        const toastId = toast.loading("Generating CSV...");
        try {
            await generateCSV(reportType, dateRange);
            toast.success("CSV Downloaded", { id: toastId });
        } catch (e) {
            console.error(e);
            toast.error("Failed to generate CSV", { id: toastId });
        }
    };

    // Digest Logic -----------------------------------------------------------------------

    const handlePreview = async (report) => {
        const html = await generateDigestHTML(report);
        setPreviewHtml(html); // Already sanitized in service
        setIsPreviewing(true);
    };

    const handleSendTest = async (report) => {
        const toastId = toast.loading("Sending test...");
        try {
            const html = await generateDigestHTML(report);
            // Attempt to send via API
            await sendEmail(settings, {
                to: settings.email || 'admin@example.com', // Fallback if no specific target
                subject: `[Test] ${report.title}`,
                content: html,
                type: 'digest'
            });
            toast.success("Test report sent!", { id: toastId });
        } catch (e) {
            console.error("Test send failed", e);
            toast.error("Failed to send test. Check API settings.", { id: toastId });
        }
    };

    const handleDelete = async (id) => {
        await db.reports.delete(id);
        toast.success("Report schedule deleted");
    };

    const handleCreate = async () => {
        if (!newReport.title) return toast.error("Please enter a title");
        await db.reports.add({ ...newReport });
        setIsCreating(false);
        setNewReport({ title: '', frequency: 'Daily', time: '09:00', channels: [], metrics: [] });
        toast.success("New digest scheduled!");
    };

    const toggleSelection = (field, value) => {
        setNewReport(prev => {
            const current = prev[field];
            if (current.includes(value)) {
                return { ...prev, [field]: current.filter(i => i !== value) };
            } else {
                return { ...prev, [field]: [...current, value] };
            }
        });
    };

    return (
        <div style={{ padding: 'var(--spacing-lg)', animation: 'fadeIn 0.5s ease' }}>
            <Toaster position="top-right" theme="dark" />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FileText color="#ec4899" /> Reports & Digests
                    </h2>
                    <p style={{ color: 'var(--text-muted)' }}>Generate on-demand reports or schedule automated digests.</p>
                </div>

                <div className="glass-toggle-group">
                    <button className={`toggle-btn ${activeTab === 'generate' ? 'active' : ''}`} onClick={() => setActiveTab('generate')}>Templates</button>
                    <button className={`toggle-btn ${activeTab === 'builder' ? 'active' : ''}`} onClick={() => setActiveTab('builder')}>Custom Builder</button>
                    <button className={`toggle-btn ${activeTab === 'digests' ? 'active' : ''}`} onClick={() => setActiveTab('digests')}>Scheduled</button>
                </div>
            </div>

            {activeTab === 'builder' && <CustomReportBuilder />}

            {activeTab === 'generate' ? (
                <div className="glass-panel" style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
                    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                        <h3 className="section-title text-center mb-6">Generate New Report</h3>

                        <div className="report-form-group">
                            <label className="report-label">Select Report Type</label>
                            <div className="report-type-grid">
                                <div
                                    className={`report-type-card ${reportType === 'sales' ? 'active' : ''}`}
                                    onClick={() => setReportType('sales')}
                                >
                                    <div className="icon-box sales">
                                        <BarChart2 size={20} />
                                    </div>
                                    <div className="report-type-title">Sales Performance</div>
                                    <div className="report-type-desc">Revenue, orders, AOV & trends</div>
                                </div>

                                <div
                                    className={`report-type-card ${reportType === 'inventory' ? 'active' : ''}`}
                                    onClick={() => setReportType('inventory')}
                                >
                                    <div className="icon-box inventory">
                                        <FileText size={20} />
                                    </div>
                                    <div className="report-type-title">Inventory Status</div>
                                    <div className="report-type-desc">Stock levels, value & low stock</div>
                                </div>

                                <div
                                    className={`report-type-card ${reportType === 'price_updates' ? 'active' : ''}`}
                                    onClick={() => setReportType('price_updates')}
                                >
                                    <div className="icon-box inventory" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>
                                        <Clock size={20} />
                                    </div>
                                    <div className="report-type-title">Price Updates</div>
                                    <div className="report-type-desc">Recent price changes & history</div>
                                </div>

                                <div
                                    className={`report-type-card ${reportType === 'dead_stock' ? 'active' : ''}`}
                                    onClick={() => setReportType('dead_stock')}
                                >
                                    <div className="icon-box inventory" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                                        <PackageX size={20} />
                                    </div>
                                    <div className="report-type-title">Dead Stock</div>
                                    <div className="report-type-desc">Products not sold in selection</div>
                                </div>
                            </div>
                        </div>

                        {(reportType === 'sales' || reportType === 'dead_stock') && (
                            <div className="report-form-group">
                                <label className="report-label">Data Range</label>
                                <select className="report-select" onChange={(e) => setDateRange({ days: parseInt(e.target.value), label: e.target.options[e.target.selectedIndex].text })}>
                                    <option value="7">Last 7 Days</option>
                                    <option value="30" selected>Last 30 Days</option>
                                    <option value="90">Last 90 Days</option>
                                    <option value="365">Last Year</option>
                                </select>
                            </div>
                        )}

                        <div className="report-actions">
                            <button onClick={downloadPDF} className="action-btn btn-pdf">
                                <FileText size={18} style={{ marginRight: '8px' }} /> Download PDF
                            </button>
                            <button onClick={downloadCSV} className="action-btn btn-csv">
                                <BarChart2 size={18} style={{ marginRight: '8px' }} /> Download CSV
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                        <button onClick={() => setIsCreating(true)} className="btn btn-primary">
                            <Plus size={18} /> New Digest
                        </button>
                    </div>

                    {/* Creating Interface */}
                    {isCreating && (
                        <div className="glass-panel" style={{ marginBottom: '2rem', padding: 'var(--spacing-lg)', border: '1px solid var(--primary)', animation: 'slideDown 0.3s ease' }}>
                            <h3 className="section-title">Configure New Digest</h3>

                            <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                {/* Left Col: Basics */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label className="form-label">Report Title</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="e.g. Daily Revenue Update"
                                            value={newReport.title}
                                            onChange={e => setNewReport({ ...newReport, title: e.target.value })}
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label className="form-label">Frequency</label>
                                            <select
                                                className="form-input"
                                                value={newReport.frequency}
                                                onChange={e => setNewReport({ ...newReport, frequency: e.target.value })}
                                                style={{ appearance: 'auto' }}
                                            >
                                                <option>Daily</option>
                                                <option>Weekly</option>
                                                <option>Monthly</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label">Time</label>
                                            <input
                                                type="time"
                                                className="form-input"
                                                value={newReport.time}
                                                onChange={e => setNewReport({ ...newReport, time: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Right Col: Content & Channels */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    <div>
                                        <label className="form-label">Include Metrics</label>
                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                            {[
                                                { id: 'sales', label: 'Total Sales' },
                                                { id: 'visitors', label: 'Visitors' },
                                                { id: 'products', label: 'Top Products' },
                                                { id: 'customers', label: 'New Customers' },
                                                { id: 'automations', label: 'Flow Performance' }
                                            ].map(m => (
                                                <div
                                                    key={m.id}
                                                    onClick={() => toggleSelection('metrics', m.id)}
                                                    style={{
                                                        padding: '8px 16px',
                                                        borderRadius: '20px',
                                                        border: `1px solid ${newReport.metrics.includes(m.id) ? 'var(--primary)' : 'var(--border-glass)'}`,
                                                        background: newReport.metrics.includes(m.id) ? 'rgba(236, 72, 153, 0.2)' : 'transparent',
                                                        color: newReport.metrics.includes(m.id) ? '#ec4899' : 'var(--text-muted)',
                                                        cursor: 'pointer',
                                                        fontSize: '0.9rem',
                                                        transition: 'all 0.2s'
                                                    }}
                                                >
                                                    {m.label}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="form-label">Send via</label>
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            <button
                                                onClick={() => toggleSelection('channels', 'email')}
                                                className={`btn ${newReport.channels.includes('email') ? 'btn-primary' : ''}`}
                                                style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--border-glass)' }}
                                            >
                                                <Mail size={18} style={{ marginRight: '8px' }} /> Email
                                            </button>
                                            <button
                                                onClick={() => toggleSelection('channels', 'slack')}
                                                className={`btn ${newReport.channels.includes('slack') ? 'btn-primary' : ''}`}
                                                style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--border-glass)' }}
                                            >
                                                <Slack size={18} style={{ marginRight: '8px' }} /> Slack
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button onClick={() => setIsCreating(false)} className="btn">Cancel</button>
                                <button onClick={handleCreate} className="btn btn-primary">Save Digest</button>
                            </div>
                        </div>
                    )}

                    {/* List of Reports */}
                    <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--spacing-md)' }}>
                        {reports.map(report => (
                            <div key={report.id} className="glass-panel" style={{ padding: 'var(--spacing-md)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'flex-start' }}>
                                    <h3 className="card-title" style={{ fontSize: '1.3rem' }}>{report.title}</h3>
                                    <button onClick={() => handleDelete(report.id)} className="btn-icon hover-red">
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                        <Clock size={16} />
                                        <span>{report.frequency} at {report.time}</span>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                        <BarChart2 size={16} />
                                        <span>Includes: {report.metrics.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')}</span>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                        {report.channels.map(c => (
                                            <div key={c} title={`Sends to ${c}`} style={{ background: 'rgba(255,255,255,0.1)', padding: '6px', borderRadius: '8px' }}>
                                                {c === 'email' && <Mail size={16} />}
                                                {c === 'slack' && <Slack size={16} />}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#10b981' }}>
                                        <CheckCircle size={14} /> Active
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button onClick={() => handlePreview(report)} className="btn" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                                            <Eye size={14} style={{ marginRight: '4px' }} /> Preview
                                        </button>
                                        <button onClick={() => handleSendTest(report)} className="btn" style={{ padding: '6px 12px', fontSize: '0.85rem', background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                                            <Send size={14} style={{ marginRight: '4px' }} /> Send Now
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Preview Modal */}
            {isPreviewing && (
                <div className="modal-overlay">
                    <div className="modal-content glass-panel" style={{ width: '700px', maxWidth: '90vw' }}>
                        <div className="modal-header">
                            <h3>Digest Preview</h3>
                            <button className="btn-icon" onClick={() => setIsPreviewing(false)}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div style={{ border: '2px dashed #4b5563', padding: '10px', background: '#374151', borderRadius: '4px', textAlign: 'center', marginBottom: '10px', color: '#9ca3af', fontSize: '0.8rem' }}>
                                Email Preview (HTML)
                            </div>
                            <div dangerouslySetInnerHTML={{ __html: previewHtml }} style={{ maxHeight: '60vh', overflowY: 'auto', borderRadius: '8px' }} />
                        </div>
                        <div className="modal-actions" style={{ justifyContent: 'flex-end', display: 'flex' }}>
                            <button className="btn" onClick={() => setIsPreviewing(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Reports;
