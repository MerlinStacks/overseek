export function formatReviewText(content?: string): string {
    if (!content) return '';

    const withBreaks = content
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\s*\/p\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '');

    if (typeof document === 'undefined') {
        return withBreaks.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim();
    }

    const textarea = document.createElement('textarea');
    textarea.innerHTML = withBreaks;
    return textarea.value.replace(/\n{3,}/g, '\n\n').trim();
}

export function formatReviewStatusLabel(status: string): string {
    if (status === 'approved') return 'Published';
    if (status === 'hold') return 'Pending';
    return status.charAt(0).toUpperCase() + status.slice(1);
}
