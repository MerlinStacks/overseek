import { useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
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
    const button = 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
    return <nav aria-label="Pagination" className={cn('flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300', className)}>
        {allowItemsPerPage && onItemsPerPageChange && <label className="flex items-center gap-2 text-xs font-medium">Rows per page <select className="rounded-md border border-slate-200 bg-white p-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800" value={[15, 25, 50, 100].includes(itemsPerPage ?? 0) ? itemsPerPage : ''} onChange={event => { const value = Number(event.target.value); if ([15, 25, 50, 100].includes(value) && value !== itemsPerPage) onItemsPerPageChange(value); }}><option value="" disabled>Select</option>{[15, 25, 50, 100].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        <span role="status" className="text-xs tabular-nums">{totalPages === 0 ? 'No pages' : valid ? `Page ${currentPage} of ${totalPages}` : 'Pagination unavailable'}</span>
        <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={button} disabled={!valid || currentPage === 1} onClick={() => navigate(1)} aria-label="First Page" title="First Page"><ChevronsLeft size={16} /></button>
        <button type="button" className={button} disabled={!valid || currentPage === 1} onClick={() => navigate(currentPage - 1)} aria-label="Previous Page" title="Previous Page"><ChevronLeft size={16} /></button>
        <label htmlFor={id} className="sr-only">Go to</label><input id={id} type="number" inputMode="numeric" min={1} max={valid ? totalPages : undefined} step={1} value={draft} disabled={!valid} onChange={event => { submitted.current = null; setDraft(event.target.value); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') setDraft(String(currentPage)); }} className="h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800" />
        <button type="button" className={button} disabled={!valid || currentPage === totalPages} onClick={() => navigate(currentPage + 1)} aria-label="Next Page" title="Next Page"><ChevronRight size={16} /></button>
        <button type="button" className={button} disabled={!valid || currentPage === totalPages} onClick={() => navigate(totalPages)} aria-label="Last Page" title="Last Page"><ChevronsRight size={16} /></button>
        </div>
    </nav>;
}
