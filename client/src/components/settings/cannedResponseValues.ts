import DOMPurify from 'dompurify';

export function hasResponseText(content: string): boolean {
    const text = DOMPurify.sanitize(content, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    const decoder = document.createElement('textarea'); decoder.innerHTML = text;
    return !!decoder.value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}
export function validLabelColor(color: string): boolean { return /^#[a-f\d]{6}$/i.test(color); }
