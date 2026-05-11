export interface SeoTestResult {
    test: string;
    passed: boolean;
    message: string;
}

export interface ContentSeoPayload {
    title: string;
    content?: string | null;
    excerpt?: string | null;
    slug?: string | null;
    permalink?: string | null;
    focusKeyword?: string | null;
}

export interface ContentSeoResult {
    score: number;
    tests: SeoTestResult[];
}

function stripHtml(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function calculateContentSeoScore(payload: ContentSeoPayload): ContentSeoResult {
    const tests: SeoTestResult[] = [];
    let score = 0;
    let totalWeight = 0;

    const addTest = (test: string, passed: boolean, message: string, weight = 10) => {
        tests.push({ test, passed, message });
        totalWeight += weight;
        if (passed) score += weight;
    };

    const title = payload.title || '';
    const textContent = stripHtml(payload.content || payload.excerpt || '');
    const urlPath = (payload.slug || payload.permalink || '').toLowerCase();

    addTest('Title Length', title.length >= 30 && title.length <= 60, 'Keep title between 30 and 60 characters', 20);
    addTest('Body Content Length', textContent.length >= 300, 'Add more body content (target at least 300 characters)', 20);

    const keyword = payload.focusKeyword?.trim() || '';
    if (keyword) {
        const lowerKeyword = keyword.toLowerCase();
        addTest('Focus Keyword Set', true, 'Focus keyword is set', 0);
        addTest('Keyword in Title', title.toLowerCase().includes(lowerKeyword), 'Include focus keyword in title', 20);
        addTest('Keyword in Content', textContent.toLowerCase().includes(lowerKeyword), 'Include focus keyword in content', 25);
        addTest('Keyword in URL', urlPath.includes(lowerKeyword.replace(/\s+/g, '-')), 'Include focus keyword in URL slug', 15);
    } else {
        addTest('Focus Keyword Set', false, 'Set a focus keyword to unlock full analysis', 0);
        totalWeight += 60;
    }

    return {
        score: totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 0,
        tests,
    };
}
