export interface CatalogPrompt { title: string; requiresPassword: boolean; privacyNotice: string; expiresAt: string }
export interface CatalogIdentityNotice { privacyNotice: string; confidentialityText: string }
export interface CatalogPages { pageCount: number; expiresAt: string; expiredPricing?: boolean; viewer: { name: string } }

export class CatalogViewError extends Error {
    constructor(readonly status: number) {
        super('Catalog is unavailable or access could not be verified');
    }
}

const root = (token: string) => `/api/catalog-view/${encodeURIComponent(token)}`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, credentials: 'include', headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
    if (!response.ok) throw new CatalogViewError(response.status);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}

export const catalogViewService = {
    prompt: (token: string) => request<CatalogPrompt>(root(token)),
    unlock: (token: string, password: string) => request<{ privacyNotice: string }>(`${root(token)}/unlock`, { method: 'POST', body: JSON.stringify({ password }) }),
    identify: (token: string, name: string, email: string) => request<CatalogIdentityNotice>(`${root(token)}/identify`, { method: 'POST', body: JSON.stringify({ name, email }) }),
    accept: (token: string) => request<{ accepted: true }>(`${root(token)}/accept`, { method: 'POST', body: '{}' }),
    pages: (token: string) => request<CatalogPages>(`${root(token)}/pages`),
    image: async (token: string, page: number, thumbnail = false) => {
        const response = await fetch(`${root(token)}/${thumbnail ? 'thumbnails' : 'pages'}/${page}`, { credentials: 'include' });
        if (!response.ok) throw new CatalogViewError(response.status);
        return response.blob();
    },
    logout: (token: string) => request<void>(`${root(token)}/logout`, { method: 'POST', body: '{}' }),
};
