import { api } from './api';

type ProductPayload = Record<string, unknown>;

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
    }
};
