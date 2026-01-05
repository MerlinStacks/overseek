import { api } from './api';

export const ProductService = {
    getProduct: async (id: string, token: string, accountId: string): Promise<any> => {
        return api.get<any>(`/api/products/${id}`, token, accountId);
    },

    updateProduct: async (id: string, data: any, token: string, accountId: string): Promise<any> => {
        return api.patch<any>(`/api/products/${id}`, data, token, accountId);
    },

    syncProduct: async (id: string, token: string, accountId: string): Promise<any> => {
        return api.post<any>(`/api/products/${id}/sync`, {}, token, accountId);
    }
};
