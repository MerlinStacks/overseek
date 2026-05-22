export const LTR_TEXT_STYLE = {
    direction: 'ltr',
    unicodeBidi: 'plaintext',
    writingMode: 'horizontal-tb',
} as const;

export function sanitizeBidiText(value: string): string {
    return value.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '');
}
