import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../../utils/cn';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    itemsPerPage?: number;
    onItemsPerPageChange?: (limit: number) => void;
    allowItemsPerPage?: boolean;
    className?: string;
}

export function Pagination({
    currentPage,
    totalPages,
    onPageChange,
    itemsPerPage,
    onItemsPerPageChange,
    allowItemsPerPage = false,
    className
}: PaginationProps) {
    const isFirstPage = currentPage <= 1;
    const isLastPage = currentPage >= totalPages;

    const Button = ({
        onClick,
        disabled,
        children,
        title
    }: {
        onClick: () => void;
        disabled: boolean;
        children: React.ReactNode;
        title: string;
    }) => (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={cn(
                "p-2 border border-slate-200 rounded-lg text-slate-600 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            )}
        >
            {children}
        </button>
    );

    return (
        <div className={cn("flex flex-wrap items-center justify-between gap-4 p-4 pr-24 bg-slate-50 border-t border-slate-100", className)}>
            {/* Items Per Page Selector */}
            <div className="flex items-center gap-2 text-sm text-slate-600">
                {allowItemsPerPage && itemsPerPage && onItemsPerPageChange && (
                    <>
                        <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Rows:</span>
                        <select
                            value={itemsPerPage}
                            onChange={(e) => onItemsPerPageChange(Number(e.target.value))}
                            className="bg-white border border-slate-200 text-slate-700 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 block p-1.5 outline-none"
                        >
                            {[15, 25, 50, 100].map((pageSize) => (
                                <option key={pageSize} value={pageSize}>
                                    {pageSize}
                                </option>
                            ))}
                        </select>
                    </>
                )}
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-2">
                <Button
                    onClick={() => onPageChange(1)}
                    disabled={isFirstPage}
                    title="First Page"
                >
                    <ChevronsLeft size={16} />
                </Button>

                <Button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={isFirstPage}
                    title="Previous Page"
                >
                    <ChevronLeft size={16} />
                </Button>

                <span className="text-sm font-medium text-slate-600 min-w-[100px] text-center">
                    Page <span className="text-slate-900">{currentPage}</span> of <span className="text-slate-900">{Math.max(1, totalPages)}</span>
                </span>

                <Button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={isLastPage}
                    title="Next Page"
                >
                    <ChevronRight size={16} />
                </Button>

                <Button
                    onClick={() => onPageChange(totalPages)}
                    disabled={isLastPage}
                    title="Last Page"
                >
                    <ChevronsRight size={16} />
                </Button>
            </div>
        </div>
    );
}
