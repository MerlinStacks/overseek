import React, { useState, useEffect } from 'react';
import { Plus, X, Filter, Save, Trash2, FolderOpen } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { toast } from 'sonner';
import './FilterBuilder.css';

const operators = {
    number: [
        { label: 'is equal to', value: 'eq' },
        { label: 'is greater than', value: 'gt' },
        { label: 'is less than', value: 'lt' },
    ],
    string: [
        { label: 'contains', value: 'contains' },
        { label: 'is exact', value: 'is' },
    ],
    date: [
        { label: 'is after', value: 'after' },
        { label: 'is before', value: 'before' },
    ]
};

const fields = [
    { label: 'Total Spent', key: 'total_spent', type: 'number' },
    { label: 'Order Count', key: 'orders_count', type: 'number' },
    { label: 'Last Order Date', key: 'last_order_date', type: 'date' },
    { label: 'City', key: 'billing.city', type: 'string' },
    { label: 'State', key: 'billing.state', type: 'string' },
    { label: 'Country', key: 'billing.country', type: 'string' },
    { label: 'Email', key: 'email', type: 'string' },
];

const FilterBuilder = ({ onApply, context = 'customers', fields = [] }) => {
    const [filters, setFilters] = useState([]);
    const [segmentName, setSegmentName] = useState('');
    const [showSave, setShowSave] = useState(false);

    // Default fields if none provided (Legacy Fallback)
    const activeFields = fields.length > 0 ? fields : [
        { label: 'Total Spent', key: 'total_spent', type: 'number' },
        { label: 'Order Count', key: 'orders_count', type: 'number' },
        { label: 'Last Order Date', key: 'last_order_date', type: 'date' },
        { label: 'City', key: 'billing.city', type: 'string' },
        { label: 'State', key: 'billing.state', type: 'string' },
        { label: 'Country', key: 'billing.country', type: 'string' },
        { label: 'Email', key: 'email', type: 'string' },
    ];

    // Fetch segments related to this context (e.g., 'customers')
    const savedSegments = useLiveQuery(() => db.segments.where('context').equals(context).toArray()) || [];

    const addFilter = () => {
        setFilters([...filters, { field: activeFields[0].key, operator: 'gt', value: '' }]);
    };

    const removeFilter = (index) => {
        const newFilters = filters.filter((_, i) => i !== index);
        setFilters(newFilters);
    };

    const updateFilter = (index, key, val) => {
        const newFilters = [...filters];
        newFilters[index][key] = val;

        // Reset operator if field type changes
        if (key === 'field') {
            const fieldDef = activeFields.find(f => f.key === val);
            const type = fieldDef?.type || 'string';
            newFilters[index].operator = operators[type][0].value;
            newFilters[index].value = ''; // Reset value
        }

        setFilters(newFilters);
    };

    const handleApply = () => {
        onApply(filters);
    };

    const handleSaveSegment = async () => {
        if (!segmentName.trim()) {
            toast.error("Please enter a name for this segment");
            return;
        }

        try {
            await db.segments.add({
                name: segmentName,
                context: context,
                filters: filters
            });
            toast.success("Segment saved!");
            setSegmentName('');
            setShowSave(false);
        } catch (error) {
            console.error(error);
            toast.error("Failed to save segment");
        }
    };

    const handleLoadSegment = (segment) => {
        setFilters(segment.filters);
        onApply(segment.filters); // Apply immediately on load
        toast.success(`Loaded segment: ${segment.name}`);
    };

    const handleDeleteSegment = async (id, e) => {
        e.stopPropagation();
        if (window.confirm("Delete this segment?")) {
            await db.segments.delete(id);
            toast.success("Segment deleted");
        }
    };

    return (
        <div className="filter-builder glass-panel">
            <div className="filter-header" style={{ justifyContent: 'space-between' }}>
                <span className="filter-title"><Filter size={16} /> Segment {context === 'customers' ? 'Customers' : 'Orders'}</span>

                {/* Saved Segments Dropdown */}
                {savedSegments.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Load:</span>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {savedSegments.map(seg => (
                                <button
                                    key={seg.id}
                                    className="btn"
                                    onClick={() => handleLoadSegment(seg)}
                                    style={{ fontSize: '0.75rem', padding: '2px 8px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '4px' }}
                                >
                                    <FolderOpen size={10} />
                                    {seg.name}
                                    <Trash2 size={10} className="hover-red" onClick={(e) => handleDeleteSegment(seg.id, e)} style={{ marginLeft: '4px', opacity: 0.5 }} />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="filters-list">
                {filters.length === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', border: '1px dashed var(--border-glass)', borderRadius: '8px' }}>
                        No filters applied. Click 'Add Filter' to start.
                    </div>
                )}

                {filters.map((filter, index) => {
                    const fieldDef = activeFields.find(f => f.key === filter.field);
                    const type = fieldDef?.type || 'string';
                    const currentOperators = operators[type];

                    return (
                        <div key={index} className="filter-row">
                            <select
                                className="form-input"
                                value={filter.field}
                                onChange={(e) => updateFilter(index, 'field', e.target.value)}
                                style={{ width: '150px' }}
                            >
                                {activeFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>

                            <select
                                className="form-input"
                                value={filter.operator}
                                onChange={(e) => updateFilter(index, 'operator', e.target.value)}
                                style={{ width: '140px' }}
                            >
                                {currentOperators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                            </select>

                            {type === 'date' ? (
                                <input
                                    type="date"
                                    className="form-input"
                                    value={filter.value}
                                    onChange={(e) => updateFilter(index, 'value', e.target.value)}
                                    style={{ flex: 1 }}
                                />
                            ) : (
                                <input
                                    type={type === 'number' ? 'number' : 'text'}
                                    className="form-input"
                                    value={filter.value}
                                    onChange={(e) => updateFilter(index, 'value', e.target.value)}
                                    placeholder="Value..."
                                    style={{ flex: 1 }}
                                />
                            )}

                            <button onClick={() => removeFilter(index)} className="btn-icon text-error">
                                <X size={16} />
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="filter-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={addFilter} className="btn" style={{ fontSize: '0.85rem' }}>
                        <Plus size={14} style={{ marginRight: '4px' }} /> Add Filter
                    </button>
                    {filters.length > 0 && (
                        <button onClick={handleApply} className="btn btn-primary" style={{ fontSize: '0.85rem' }}>
                            Apply
                        </button>
                    )}
                </div>

                {filters.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {!showSave ? (
                            <button onClick={() => setShowSave(true)} className="btn" style={{ fontSize: '0.85rem' }}>
                                <Save size={14} style={{ marginRight: '4px' }} /> Save Segment
                            </button>
                        ) : (
                            <div className="animate-fade-in" style={{ display: 'flex', gap: '4px' }}>
                                <input
                                    className="form-input"
                                    placeholder="Segment Name"
                                    style={{ padding: '4px 8px', width: '150px' }}
                                    value={segmentName}
                                    onChange={(e) => setSegmentName(e.target.value)}
                                    autoFocus
                                />
                                <button onClick={handleSaveSegment} className="btn btn-primary" style={{ padding: '4px 8px' }}>Save</button>
                                <button onClick={() => setShowSave(false)} className="btn" style={{ padding: '4px' }}><X size={14} /></button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FilterBuilder;
