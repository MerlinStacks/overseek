
import React, { useState } from 'react';
import { Columns, Check, X } from 'lucide-react';
import './ColumnSelector.css';

const ColumnSelector = ({ availableColumns, visibleColumns, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);

    const toggleColumn = (columnId) => {
        let newColumns;
        if (visibleColumns.includes(columnId)) {
            newColumns = visibleColumns.filter(id => id !== columnId);
        } else {
            newColumns = [...visibleColumns, columnId];
        }
        // Ensure the order matches availableColumns order
        newColumns.sort((a, b) => {
            const indexA = availableColumns.findIndex(col => col.id === a);
            const indexB = availableColumns.findIndex(col => col.id === b);
            return indexA - indexB;
        });

        onChange(newColumns);
    };

    return (
        <div className="column-selector-container">
            <button
                className={`btn ${isOpen ? 'active' : ''}`}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={() => setIsOpen(!isOpen)}
            >
                <Columns size={18} /> Columns
            </button>

            {isOpen && (
                <>
                    <div className="column-selector-backdrop" onClick={() => setIsOpen(false)} />
                    <div className="column-selector-dropdown glass-panel">
                        <div className="column-selector-header">
                            <span style={{ fontWeight: 600 }}>Edit Columns</span>
                            <button className="btn-icon" onClick={() => setIsOpen(false)}>
                                <X size={16} />
                            </button>
                        </div>
                        <div className="column-list">
                            {availableColumns.map(col => (
                                <div
                                    key={col.id}
                                    className={`column-item ${visibleColumns.includes(col.id) ? 'selected' : ''}`}
                                    onClick={() => toggleColumn(col.id)}
                                >
                                    <div className="checkbox-custom">
                                        {visibleColumns.includes(col.id) && <Check size={12} />}
                                    </div>
                                    <span>{col.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ColumnSelector;
