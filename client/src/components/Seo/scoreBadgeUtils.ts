export function normalizedScore(score: number): number | null {
    return typeof score === 'number' && Number.isFinite(score) ? Math.round(Math.max(0, Math.min(100, score))) : null;
}

export function scoreBadgeColor(score: number | null): string {
    if (score == null) return 'text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-600';
    if (score > 70) return 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-950 dark:border-green-800';
    if (score > 40) return 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-300 dark:bg-yellow-950 dark:border-yellow-800';
    return 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950 dark:border-red-800';
}

export const scoreBadgeSizes = { sm: 'text-xs px-2 py-0.5', md: 'text-sm px-2.5 py-1', lg: 'text-base px-3 py-1.5' };
