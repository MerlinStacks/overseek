import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

const Pagination = ({
    currentPage,
    totalPages,
    itemsPerPage,
    onPageChange,
    onItemsPerPageChange,
    totalItems,
    className = ""
}) => {
    if (totalPages <= 1 && totalItems <= itemsPerPage) return null;

    const pageSizeOptions = [10, 15, 25, 50, 100, 500];

    // Calculate range of items being shown
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);

    const handlePrev = () => {
        if (currentPage > 1) onPageChange(currentPage - 1);
    };

    const handleNext = () => {
        if (currentPage < totalPages) onPageChange(currentPage + 1);
    };

    const handleFirst = () => {
        if (currentPage !== 1) onPageChange(1);
    }

    const handleLast = () => {
        if (currentPage !== totalPages) onPageChange(totalPages);
    }

    return (
        <div className={`pagination-container ${className}`} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem',
            borderTop: '1px solid var(--border-glass)',
            color: 'var(--text-muted)',
            fontSize: '0.9rem'
        }}>
            {/* Left: Items per page & Stats */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>Show</span>
                    <select
                        value={itemsPerPage}
                        onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
                        className="form-input"
                        style={{ width: 'auto', padding: '4px 8px', fontSize: '0.9rem' }}
                    >
                        {pageSizeOptions.map(size => (
                            <option key={size} value={size}>{size}</option>
                        ))}
                    </select>
                </div>
                <span>
                    Showing {startItem}-{endItem} of {totalItems}
                </span>
            </div>

            {/* Right: Navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                    onClick={handleFirst}
                    disabled={currentPage === 1}
                    className="btn-icon"
                    style={{ opacity: currentPage === 1 ? 0.3 : 1 }}
                    title="First Page"
                >
                    <ChevronsLeft size={16} />
                </button>
                <button
                    onClick={handlePrev}
                    disabled={currentPage === 1}
                    className="btn-icon"
                    style={{ opacity: currentPage === 1 ? 0.3 : 1 }}
                    title="Previous"
                >
                    <ChevronLeft size={16} />
                </button>

                <span style={{ margin: '0 8px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    Page {currentPage} of {totalPages}
                </span>

                <button
                    onClick={handleNext}
                    disabled={currentPage === totalPages}
                    className="btn-icon"
                    style={{ opacity: currentPage === totalPages ? 0.3 : 1 }}
                    title="Next"
                >
                    <ChevronRight size={16} />
                </button>
                <button
                    onClick={handleLast}
                    disabled={currentPage === totalPages}
                    className="btn-icon"
                    style={{ opacity: currentPage === totalPages ? 0.3 : 1 }}
                    title="Last Page"
                >
                    <ChevronsRight size={16} />
                </button>
            </div>
        </div>
    );
};

export default Pagination;
