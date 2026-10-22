import { api } from './api';
import { isRecord } from '../utils/responseValidation';

interface Supplier {
    id: string;
    name: string;
    [key: string]: unknown;
}

export const InventoryService = {
    getSuppliers: async (token: string, accountId: string, signal?: AbortSignal): Promise<Supplier[]> => {
        if (!token || !accountId) throw new Error('Sign in and select an account before loading suppliers.');
        const value = await api.request<unknown>('/api/inventory/suppliers', { token, accountId, signal });
        signal?.throwIfAborted();
        const seen = new Set<string>();
        if (!Array.isArray(value) || value.length > 50000 || !value.every(supplier => {
            if (!isRecord(supplier) || typeof supplier.id !== 'string' || !supplier.id.trim() || supplier.id.length > 500 || typeof supplier.name !== 'string' || !supplier.name.trim() || supplier.name.length > 10000 || seen.has(supplier.id)) return false;
            seen.add(supplier.id); return true;
        })) throw new Error('Supplier data is invalid. Please retry.');
        return value as Supplier[];
    }
};
