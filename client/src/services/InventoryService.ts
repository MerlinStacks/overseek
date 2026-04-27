import { api } from './api';

export interface Supplier {
    id: string;
    name: string;
    [key: string]: unknown;
}

export const InventoryService = {
    getSuppliers: async (token: string, accountId: string): Promise<Supplier[]> => {
        return api.get<Supplier[]>('/api/inventory/suppliers', token, accountId);
    }
};
