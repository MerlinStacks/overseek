import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { Plus, Trash2, Save, Play, FileText, ChevronRight, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import './CustomReportBuilder.css';

/**
 * A component to build and run custom reports.
 */
const CustomReportBuilder = () => {
    // Mode: 'list' | 'build' | 'view'
    const [viewMode, setViewMode] = useState('list');

    // Saved Reports
    const [savedReports, setSavedReports] = useState([]);

    // Builder State
    const [reportName, setReportName] = useState('');
    const [source, setSource] = useState('orders'); // 'orders', 'products', 'customers'
    const [selectedColumns, setSelectedColumns] = useState([]);
    const [filters, setFilters] = useState([]); // [{ field, operator, value }]

    // Execution Result
    const [results, setResults] = useState([]);
    const [currentReport, setCurrentReport] = useState(null);

    // Schema Definitions for Columns
    const schemas = {
        orders: [
            { id: 'id', label: 'Order ID' },
            { id: 'status', label: 'Status' },
            { id: 'total', label: 'Total' },
            { id: 'date_created', label: 'Date Created' },
            { id: 'customer_id', label: 'Customer ID' }
        ],
        products: [
            { id: 'id', label: 'Product ID' },
            { id: 'name', label: 'Name' },
            { id: 'sku', label: 'SKU' },
            { id: 'price', label: 'Price' },
            { id: 'stock_quantity', label: 'Stock' },
            { id: 'status', label: 'Status' }
        ],
        customers: [
            { id: 'id', label: 'ID' },
            { id: 'first_name', label: 'First Name' },
            { id: 'last_name', label: 'Last Name' },
            { id: 'email', label: 'Email' },
            { id: 'role', label: 'Role' }
        ]
    };

    useEffect(() => {
        loadReports();
    }, []);

    const loadReports = async () => {
        const reports = await db.custom_reports.toArray();
        setSavedReports(reports);
    };

    const handleCreateNew = () => {
        setReportName('');
        setSource('orders');
        setSelectedColumns(['id', 'total', 'status']); // defaults
        setFilters([]);
        setResults([]);
        setCurrentReport(null);
        setViewMode('build');
    };

    const handleEdit = (report) => {
        setReportName(report.name);
        setSource(report.source);
        setSelectedColumns(report.columns || []);
        setFilters(report.filters || []);
        setCurrentReport(report);
        setViewMode('build');
    };

    const handleSave = async () => {
        if (!reportName.trim()) return toast.error("Please name your report");
        if (selectedColumns.length === 0) return toast.error("Select at least one column");

        const data = {
            name: reportName,
            source,
            columns: selectedColumns,
            filters
        };

        if (currentReport) {
            await db.custom_reports.update(currentReport.id, data);
            toast.success("Report updated");
        } else {
            await db.custom_reports.add(data);
            toast.success("Report saved");
        }
        loadReports();
        setViewMode('list');
    };

    const handleDelete = async (id) => {
        if (confirm("Delete this report?")) {
            await db.custom_reports.delete(id);
            loadReports();
        }
    };

    const handleRun = async () => {
        let collection = db[source];
        let data = await collection.toArray();

        // Apply Filters (Basic client-side filtering for flexibility)
        // Supported operators: equals, contains, greater, less
        if (filters.length > 0) {
            data = data.filter(item => {
                return filters.every(f => {
                    const val = item[f.field];
                    const filterVal = f.value;

                    if (f.operator === 'equals') return val == filterVal; // loose equality
                    if (f.operator === 'contains') return String(val).toLowerCase().includes(String(filterVal).toLowerCase());
                    if (f.operator === 'greater') return parseFloat(val) > parseFloat(filterVal);
                    if (f.operator === 'less') return parseFloat(val) < parseFloat(filterVal);
                    return true;
                });
            });
        }

        setResults(data);
    };

    // Columns Toggle
    const toggleColumn = (colId) => {
        setSelectedColumns(prev =>
            prev.includes(colId) ? prev.filter(c => c !== colId) : [...prev, colId]
        );
    };

    // Filter Logic
    const addFilter = () => {
        const defaultField = schemas[source][0].id;
        setFilters([...filters, { field: defaultField, operator: 'equals', value: '' }]);
    };

    const updateFilter = (index, key, val) => {
        const newFilters = [...filters];
        newFilters[index][key] = val;
        setFilters(newFilters);
    };

    const removeFilter = (index) => {
        setFilters(filters.filter((_, i) => i !== index));
    };

    // --- Render Helpers ---

    if (viewMode === 'list') {
        return (
            <div className="glass-panel p-6 animate-fade-in" style={{ padding: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 className="section-title">My Custom Reports</h3>
                    <button onClick={handleCreateNew} className="btn btn-primary">
                        <Plus size={18} className="mr-2" /> Create New
                    </button>
                </div>

                {savedReports.length === 0 ? (
                    <div className="crb-empty-state" style={{ border: '1px dashed var(--border-glass)', borderRadius: '12px' }}>
                        No custom reports yet. Create one to get started.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {savedReports.map(r => (
                            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: r.source === 'orders' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: r.source === 'orders' ? '#60a5fa' : '#34d399' }}>
                                        <FileText size={20} />
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{r.name}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{r.source} • {r.columns.length} Columns</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button onClick={() => handleEdit(r)} className="btn">Edit / Run</button>
                                    <button onClick={() => handleDelete(r.id)} className="btn-icon hover-red"><Trash2 size={18} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="glass-panel crb-container animate-fade-in" style={{ padding: '2rem' }}>
            <div className="crb-back-link" onClick={() => setViewMode('list')}>
                <ChevronRight className="rotate-180" size={16} /> Back to List
            </div>

            <div className="crb-header">
                <input
                    type="text"
                    className="crb-title-input"
                    placeholder="Report Name..."
                    value={reportName}
                    onChange={(e) => setReportName(e.target.value)}
                />
                <div className="crb-actions">
                    <button onClick={handleRun} className="btn btn-primary">
                        <Play size={18} style={{ marginRight: '8px' }} /> Run Report
                    </button>
                    <button onClick={handleSave} className="btn" style={{ border: '1px solid var(--border-glass)' }}>
                        <Save size={18} style={{ marginRight: '8px' }} /> Save Filter
                    </button>
                </div>
            </div>

            <div className="crb-grid">
                {/* SIDEBAR */}
                <div className="crb-sidebar">
                    {/* Source */}
                    <div className="crb-panel">
                        <label className="crb-panel-title">Data Source</label>
                        <select
                            className="crb-select"
                            value={source}
                            onChange={(e) => {
                                setSource(e.target.value);
                                setSelectedColumns([]);
                                setFilters([]);
                                setResults([]);
                            }}
                        >
                            <option value="orders">Orders</option>
                            <option value="products">Products</option>
                            <option value="customers">Customers</option>
                        </select>
                    </div>

                    {/* Columns */}
                    <div className="crb-panel">
                        <label className="crb-panel-title">Columns</label>
                        <div className="crb-columns-allow custom-scrollbar">
                            {schemas[source].map(col => (
                                <label key={col.id} className="crb-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={selectedColumns.includes(col.id)}
                                        onChange={() => toggleColumn(col.id)}
                                        className="crb-checkbox"
                                    />
                                    <span className={selectedColumns.includes(col.id) ? 'crb-text-active' : 'crb-text-inactive'}>{col.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="crb-panel">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <label className="crb-panel-title" style={{ margin: 0 }}>Filters</label>
                            <button onClick={addFilter} className="btn" style={{ padding: '2px 8px', fontSize: '0.8rem' }}><Plus size={12} /> Add</button>
                        </div>
                        <div className="crb-filter-list">
                            {filters.map((f, i) => (
                                <div key={i} className="crb-filter-item">
                                    <XIcon size={14} className="crb-filter-remove" onClick={() => removeFilter(i)} />
                                    <select
                                        className="crb-select"
                                        value={f.field}
                                        onChange={(e) => updateFilter(i, 'field', e.target.value)}
                                    >
                                        {schemas[source].map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                    </select>
                                    <div className="crb-filter-row">
                                        <select
                                            className="crb-select" style={{ width: '40%' }}
                                            value={f.operator}
                                            onChange={(e) => updateFilter(i, 'operator', e.target.value)}
                                        >
                                            <option value="equals">=</option>
                                            <option value="contains">Has</option>
                                            <option value="greater">{'>'}</option>
                                            <option value="less">{'<'}</option>
                                        </select>
                                        <input
                                            type="text"
                                            className="crb-input-sm" style={{ width: '60%' }}
                                            placeholder="Value..."
                                            value={f.value}
                                            onChange={(e) => updateFilter(i, 'value', e.target.value)}
                                        />
                                    </div>
                                </div>
                            ))}
                            {filters.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>No filters applied</div>}
                        </div>
                    </div>
                </div>

                {/* MAIN CONTENT (RESULTS) */}
                <div className="crb-main">
                    <div className="crb-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <div className="crb-results-header">
                            <h4 style={{ fontWeight: 600 }}>Preview Results {results.length > 0 && <span style={{ color: 'var(--primary)', marginLeft: '8px' }}>({results.length} records)</span>}</h4>

                            {results.length > 0 && (
                                <button
                                    className="btn"
                                    onClick={() => {
                                        const headers = selectedColumns.map(c => schemas[source].find(s => s.id === c)?.label || c);
                                        const rows = results.map(r => selectedColumns.map(c => r[c]));
                                        const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
                                        const encodedUri = encodeURI(csvContent);
                                        const link = document.createElement("a");
                                        link.setAttribute("href", encodedUri);
                                        link.setAttribute("download", `${reportName || 'custom'}.csv`);
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        toast.success("CSV Downloaded");
                                    }}
                                >
                                    Export CSV
                                </button>
                            )}
                        </div>

                        <div className="crb-table-wrapper custom-scrollbar">
                            {results.length === 0 ? (
                                <div className="crb-empty-state">
                                    <Play size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                                    <p>Click "Run Report" to generate preview</p>
                                </div>
                            ) : (
                                <table className="crb-table">
                                    <thead>
                                        <tr>
                                            {selectedColumns.map(colId => (
                                                <th key={colId}>
                                                    {schemas[source].find(s => s.id === colId)?.label || colId}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.slice(0, 100).map((row, idx) => (
                                            <tr key={idx}>
                                                {selectedColumns.map(colId => (
                                                    <td key={colId}>
                                                        {typeof row[colId] === 'object' ? JSON.stringify(row[colId]) : row[colId]}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {results.length > 100 && (
                            <div style={{ textAlign: 'center', padding: '10px', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-glass)' }}>
                                Showing first 100 results. Export to see all.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CustomReportBuilder;
