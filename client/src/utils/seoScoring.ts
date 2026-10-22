import DOMPurify from 'dompurify';
import { isRecord } from './responseValidation';

interface SeoAnalysisResult {
    score: number; tests: { test: string; passed: boolean; message: string }[];
    methodology: string;
}
const normalize = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';
function visibleText(value: unknown): string {
    if (typeof value !== 'string' || value.length > 1000000) return '';
    const fragment = DOMPurify.sanitize(value, { RETURN_DOM_FRAGMENT: true });
    fragment.querySelectorAll('script,style,template,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
    fragment.querySelectorAll<HTMLElement>('[style]').forEach(node => {
        if (node.style.display === 'none' || node.style.visibility === 'hidden') node.remove();
    });
    fragment.querySelectorAll('p,div,br,li,h1,h2,h3,h4,h5,h6').forEach(node => node.appendChild(document.createTextNode(' ')));
    return normalize(fragment.textContent);
}
function publicUrl(value: unknown): URL | null {
    try { const url = new URL(typeof value === 'string' ? value : ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
}
/** Local content checklist only, not a prediction of search ranking or traffic. */
export function calculateSeoScore(data: unknown, focusKeyword?: string): SeoAnalysisResult {
    const input = isRecord(data) ? data : {};
    const name = visibleText(input.name); const description = visibleText(input.description);
    const keyword = normalize(focusKeyword).toLowerCase();
    const tests: SeoAnalysisResult['tests'] = []; let score = 0; let totalWeight = 0;
    const add = (test: string, passed: boolean, success: string, failure: string, weight: number) => {
        tests.push({ test, passed, message: passed ? success : failure }); totalWeight += weight; if (passed) score += weight;
    };
    add('Product Title', name.length > 5, 'Title has sufficient text', 'Title is too short', 10);
    add('Product Description', description.length > 50, 'Description has sufficient visible text', 'Description is too short', 10);
    const images = Array.isArray(input.images) ? input.images : [];
    add('Images', images.some(image => publicUrl(isRecord(image) ? image.src : image) !== null), 'An image URL is available', 'No valid image URL found', 15);
    const price = normalize(input.price);
    add('Price', /^\d+(?:\.\d+)?$/.test(price) && Number.isFinite(Number(price)) && Number(price) <= Number.MAX_SAFE_INTEGER, 'A nonnegative numeric price is available', 'Price is missing or invalid', 5);
    add('Focus Keyword Set', !!keyword, 'Focus keyword is set', 'Add a focus keyword to complete the checklist', 0);
    if (keyword) {
        add('Keyword in Title', name.toLowerCase().includes(keyword), 'Title contains the focus keyword', 'Title does not contain the focus keyword', 20);
        add('Keyword in Description', description.toLowerCase().includes(keyword), 'Visible description contains the focus keyword', 'Visible description does not contain the focus keyword', 15);
        const url = publicUrl(input.permalink); let path = '';
        try { path = normalize(decodeURIComponent(url?.pathname || '').replace(/[-_]+/g, ' ')).toLowerCase(); } catch { /* Malformed URL encoding is not a keyword match. */ }
        add('Keyword in URL', !!path && path.includes(keyword), 'URL path contains the focus keyword', 'URL path does not contain the focus keyword', 10);
    } else totalWeight += 45;
    return { score: totalWeight ? Math.round(score / totalWeight * 100) : 0, tests,
        methodology: 'Heuristic content checklist, not search ranking evidence. External CSS visibility and Google indexing are not assessed.' };
}
