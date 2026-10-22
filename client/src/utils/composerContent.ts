/** Inert parsing for composer readiness; this does not sanitize or authorize delivery.
 * Attachment/image-only messages deliberately require accompanying text, matching send policy.
 */
export function composerText(html: string): string {
    if (typeof html !== 'string' || html.length > 200000) return '';
    const template = document.createElement('template'); template.innerHTML = html;
    template.content.querySelectorAll('script,style,noscript').forEach(node => node.remove());
    template.content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
    return (template.content.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ');
}
export function hasComposerText(html: string) { return composerText(html).trim().length > 0; }
