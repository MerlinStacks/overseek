import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** A real button supports keyboard/touch; mouse hover remains available as a preview. */
export function ScoreBadgeDetails({ label, className, children, details, interactive = true }: {
    label: string; className: string; children: ReactNode; details: ReactNode; interactive?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const id = useId();
    useEffect(() => {
        if (!open) return;
        const dismiss = (event: PointerEvent) => {
            if (!container.current?.contains(event.target as Node)) { setOpen(false); setPinned(false); }
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, [open]);
    if (!interactive) return <span aria-label={label} className={className}>{children}</span>;
    return <div ref={container} className="relative inline-flex" onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (!pinned) setOpen(false); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setPinned(false); } }}
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setPinned(false); } }}>
        <button type="button" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined}
            className={`${className} cursor-help focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-color)]`}
            onClick={event => { event.stopPropagation(); setPinned(!pinned); setOpen(!pinned); }}>
            {children}
        </button>
        {open && <div id={id} role="region" aria-label={`${label} details`} tabIndex={0}
            className="absolute left-0 top-full pt-2 z-50 w-72 max-w-[calc(100vw-2rem)]">
            <div className="bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-3 max-h-72 overflow-y-auto text-xs font-normal space-y-2">{details}</div>
        </div>}
    </div>;
}
