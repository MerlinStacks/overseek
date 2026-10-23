import type { ReactNode } from 'react';
import { ChevronDown, Info } from 'lucide-react';

/** Secondary context stays available without burying the workspace's main task. */
export function DataNote({ children, title = 'About this data' }: { children: ReactNode; title?: string }) {
    return <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium"><Info size={14} aria-hidden="true" />{title}<ChevronDown size={12} aria-hidden="true" className="ml-auto shrink-0" /></summary>
        <div className="mt-2 space-y-2 break-words">{children}</div>
    </details>;
}
