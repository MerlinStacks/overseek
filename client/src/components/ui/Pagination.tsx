import { useId, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
interface PaginationProps { currentPage: number; totalPages: number; onPageChange: (page: number) => void; itemsPerPage?: number; onItemsPerPageChange?: (limit: number) => void; allowItemsPerPage?: boolean; className?: string }
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
export function Pagination(props: PaginationProps) {
    return <ScopedPagination key={`${props.currentPage}:${props.totalPages}`} {...props} />;
}
function ScopedPagination({ currentPage, totalPages, onPageChange, itemsPerPage, onItemsPerPageChange, allowItemsPerPage = false, className }: PaginationProps) {
    const id = useId(), [draft, setDraft] = useState(integer(currentPage) ? String(currentPage) : '');
    const submitted = useRef<number | null>(null);
    const valid = integer(totalPages) && totalPages > 0 && integer(currentPage) && currentPage >= 1 && currentPage <= totalPages;
    function navigate(page: number) {
        if (!valid || !integer(page) || page < 1 || page > totalPages || page === currentPage || submitted.current === page) return;
        submitted.current = page; onPageChange(page);
    }
    function commit() {
        if (!valid || !/^[1-9]\d*$/.test(draft) || !Number.isSafeInteger(Number(draft)) || Number(draft) > totalPages) { setDraft(String(currentPage)); return; }
        navigate(Number(draft));
    }
    const button = 'rounded border border-slate-200 dark:border-slate-700 px-3 py-2 disabled:opacity-50';
    return <nav aria-label="Pagination" className={cn('flex flex-wrap items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200', className)}>
        {allowItemsPerPage && onItemsPerPageChange && <label>Rows per page <select className="rounded border bg-white dark:bg-slate-950 p-2" value={[15, 25, 50, 100].includes(itemsPerPage ?? 0) ? itemsPerPage : ''} onChange={event => { const value = Number(event.target.value); if ([15, 25, 50, 100].includes(value) && value !== itemsPerPage) onItemsPerPageChange(value); }}><option value="" disabled>Select</option>{[15, 25, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        <button type="button" className={button} disabled={!valid || currentPage === 1} onClick={() => navigate(1)} aria-label="First Page" title="First Page">First</button>
        <button type="button" className={button} disabled={!valid || currentPage === 1} onClick={() => navigate(currentPage - 1)} aria-label="Previous Page" title="Previous Page">Previous</button>
        <span role="status">{totalPages === 0 ? 'No pages' : valid ? `Page ${currentPage} of ${totalPages}` : 'Pagination unavailable'}</span>
        <label htmlFor={id}>Go to</label><input id={id} type="number" inputMode="numeric" min={1} max={valid ? totalPages : undefined} step={1} value={draft} disabled={!valid} onChange={event => { submitted.current = null; setDraft(event.target.value); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') setDraft(String(currentPage)); }} className="w-20 rounded border bg-white dark:bg-slate-950 p-2" />
        <button type="button" className={button} disabled={!valid || currentPage === totalPages} onClick={() => navigate(currentPage + 1)} aria-label="Next Page" title="Next Page">Next</button>
        <button type="button" className={button} disabled={!valid || currentPage === totalPages} onClick={() => navigate(totalPages)} aria-label="Last Page" title="Last Page">Last</button>
    </nav>;
}
