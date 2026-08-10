import { api } from './api';

type ProductPayload = Record<string, unknown>;

export interface ProductVideoItem {
    video_url: string;
    thumbnail_url: string;
}

export interface ProductVideoGallery {
    success: boolean;
    product_id: number;
    plugin_active: boolean;
    plugin_version: string | null;
    policy: 'inherit_main' | 'per_variation';
    product_video: ProductVideoItem;
    variations: Array<ProductVideoItem & {
        variation_id: number;
        sku: string;
        attributes: Record<string, string>;
    }>;
}

export interface ProductVideoUpload {
    success: boolean;
    attachment_id: number;
    source_url: string;
    mime_type: string;
}

export const ProductService = {
    getProduct: async (id: string, token: string, accountId: string): Promise<unknown> => {
        return api.get<unknown>(`/api/products/${id}`, token, accountId);
    },

    updateProduct: async (id: string, data: ProductPayload, token: string, accountId: string): Promise<unknown> => {
        return api.patch<unknown>(`/api/products/${id}`, data, token, accountId);
    },

    createProduct: async (data: ProductPayload, token: string, accountId: string): Promise<unknown> => {
        return api.post<unknown>('/api/products', data, token, accountId);
    },

    syncProduct: async (id: string, token: string, accountId: string): Promise<unknown> => {
        return api.post<unknown>(`/api/products/${id}/sync`, {}, token, accountId);
    },

    getVideoGallery: (id: number, token: string, accountId: string) =>
        api.get<ProductVideoGallery>(`/api/products/${id}/video-gallery`, token, accountId),

    updateVideoGallery: (id: number, data: Partial<ProductVideoGallery>, token: string, accountId: string) =>
        api.put<ProductVideoGallery>(`/api/products/${id}/video-gallery`, data, token, accountId),

    uploadVideo: (id: number, file: File, token: string, accountId: string) => {
        const form = new FormData();
        form.append('file', file);
        return api.request<ProductVideoUpload>(`/api/products/${id}/video-gallery/upload`, {
            method: 'POST',
            body: form,
            token,
            accountId,
        });
    },
};
