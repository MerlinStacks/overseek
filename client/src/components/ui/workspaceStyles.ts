/** Explicit opt-in styles for workspace forms and read panels. Never recolor global elements. */
const buttonBase = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
export const workspaceStyles = {
    card: 'min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800',
    title: 'text-sm font-semibold text-slate-900 dark:text-slate-100',
    muted: 'text-xs leading-relaxed text-slate-500 dark:text-slate-400',
    label: 'block min-w-0 space-y-1.5 text-xs font-medium text-slate-600 dark:text-slate-300',
    input: 'block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100',
    checkbox: 'size-4 shrink-0 rounded border-slate-300 accent-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:border-slate-600',
    primary: `${buttonBase} bg-indigo-600 text-white hover:bg-indigo-700`,
    secondary: `${buttonBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`,
    danger: `${buttonBase} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950`,
    alert: 'rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
    notice: 'rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 text-xs leading-relaxed text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200',
    empty: 'rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400',
    badge: 'inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    table: 'w-full text-left text-sm',
    tableHead: 'border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400',
    tableBody: 'divide-y divide-slate-100 dark:divide-slate-700',
    cell: 'px-4 py-3 align-top',
    link: 'text-sm font-medium text-indigo-600 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-400',
};
