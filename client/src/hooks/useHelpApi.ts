/**
 * Help Content API Hooks
 * Lazy-loads help articles from the server instead of bundling static content.
 */

import { useApiQuery } from './useApiQuery';

export interface HelpCollection {
    id: string;
    title: string;
    slug: string;
    description: string;
    icon: string;
    order: number;
    articles: Array<{
        id: string;
        title: string;
        slug: string;
        excerpt: string;
        order: number;
    }>;
}

export interface HelpArticle {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    order: number;
    updatedAt: string;
    collection: {
        id: string;
        title: string;
        slug: string;
    } | null;
}

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('token');
    const accountId = localStorage.getItem('selectedAccountId');
    return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(accountId ? { 'X-Account-ID': accountId } : {}),
    };
}

async function fetchCollections(): Promise<HelpCollection[]> {
    const res = await fetch('/api/help/collections', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to load help collections');
    return res.json();
}

async function fetchArticle(slug: string): Promise<HelpArticle | null> {
    const res = await fetch(`/api/help/articles/${slug}`, { headers: getAuthHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load article');
    return res.json();
}

async function searchHelpArticles(q: string): Promise<HelpArticle[]> {
    const res = await fetch(`/api/help/search?q=${encodeURIComponent(q)}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to search help articles');
    return res.json();
}

export function useHelpCollections() {
    return useApiQuery<HelpCollection[]>({
        queryKey: ['help-collections'],
        queryFn: fetchCollections,
        staleTime: 1000 * 60 * 5,
    });
}

export function useHelpArticle(slug: string | undefined) {
    return useApiQuery<HelpArticle | null>({
        queryKey: ['help-article', slug],
        queryFn: () => fetchArticle(slug!),
        enabled: !!slug,
        staleTime: 1000 * 60 * 5,
    });
}

export function useHelpSearch(q: string) {
    return useApiQuery<HelpArticle[]>({
        queryKey: ['help-search', q],
        queryFn: () => searchHelpArticles(q),
        enabled: q.length > 2,
        staleTime: 1000 * 60 * 1,
    });
}
