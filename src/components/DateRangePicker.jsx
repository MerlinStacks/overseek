import React, { useState } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import './DateRangePicker.css';

const RANGES = [
    { label: 'Today', days: 1, type: 'today' },
    { label: 'Yesterday', days: 1, type: 'yesterday' },
    { label: 'Last 7 Days', days: 7 },
    { label: 'Last 30 Days', days: 30 },
    { label: 'Last 90 Days', days: 90 },
    { label: 'This Year', days: 365 }, // Simplified
    { label: 'All Time', days: null }
];

const DateRangePicker = ({ range, onChange, compareMode = 'none', onCompareChange }) => {
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (r) => {
        onChange(r);
        setIsOpen(false);
    };

    const toggleCompare = () => {
        if (compareMode !== 'none') {
            onCompareChange('none');
        } else {
            onCompareChange('period'); // Default to period
        }
    };

    return (
        <div className="date-range-picker" style={{ position: 'relative' }}>
            <button
                className="btn glass-panel picker-trigger"
                onClick={() => setIsOpen(!isOpen)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '220px', justifyContent: 'space-between' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={16} />
                    <span>{range.label}</span>
                </div>
                <ChevronDown size={14} />
            </button>

            {isOpen && (
                <div className="picker-dropdown glass-panel" style={{
                    position: 'absolute',
                    top: '110%',
                    right: 0,
                    width: '260px',
                    zIndex: 50,
                    flexDirection: 'column',
                    padding: '8px'
                }}>
                    <div className="ranges-list">
                        {RANGES.map(r => (
                            <button
                                key={r.label}
                                className={`range-option ${range.label === r.label ? 'active' : ''}`}
                                onClick={() => handleSelect(r)}
                                style={{
                                    width: '100%',
                                    textAlign: 'left',
                                    padding: '8px',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    borderRadius: '4px'
                                }}
                            >
                                {r.label}
                                {range.label === r.label && <Check size={14} />}
                            </button>
                        ))}
                    </div>

                    {onCompareChange && (
                        <div className="compare-section" style={{
                            marginTop: '8px',
                            paddingTop: '8px',
                            borderTop: '1px solid rgba(255,255,255,0.1)'
                        }}>
                            <div
                                className="compare-toggle"
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}
                                onClick={toggleCompare}
                            >
                                <div className={`checkbox ${compareMode !== 'none' ? 'checked' : ''}`} style={{
                                    width: '16px', height: '16px',
                                    border: '1px solid var(--text-muted)',
                                    borderRadius: '3px',
                                    background: compareMode !== 'none' ? 'var(--primary)' : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                    {compareMode !== 'none' && <Check size={10} color="white" />}
                                </div>
                                <span style={{ fontSize: '0.9rem' }}>Compare to</span>
                            </div>

                            {compareMode !== 'none' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '24px' }}>
                                    <button
                                        className="btn-text"
                                        style={{
                                            textAlign: 'left',
                                            fontSize: '0.85rem',
                                            color: compareMode === 'period' ? 'var(--primary)' : 'var(--text-muted)',
                                            background: 'transparent', border: 'none', cursor: 'pointer'
                                        }}
                                        onClick={() => onCompareChange('period')}
                                    >
                                        Previous Period
                                    </button>
                                    <button
                                        className="btn-text"
                                        style={{
                                            textAlign: 'left',
                                            fontSize: '0.85rem',
                                            color: compareMode === 'year' ? 'var(--primary)' : 'var(--text-muted)',
                                            background: 'transparent', border: 'none', cursor: 'pointer'
                                        }}
                                        onClick={() => onCompareChange('year')}
                                    >
                                        Previous Year
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DateRangePicker;
