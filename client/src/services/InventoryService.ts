import { api } from './api';

export const InventoryService = {
    getSuppliers: async (token: string, accountId: string): Promise<any[]> => {
        return api.get<any[]>('/api/inventory/suppliers', token, accountId);
    }
};
