/**
 * Inventory Routes - Modular Index
 * 
 * Composes inventory-related route modules into exports.
 * 
 * Module Structure:
 * - suppliers.ts: Supplier CRUD and supplier items
 * - bomSync.ts: BOM inventory sync with WooCommerce
 * - bomManagement.ts: Deactivated BOM item visibility and reactivation
 */

export { supplierRoutes } from './suppliers';
export { bomSyncRoutes } from './bomSync';
export { bomManagementRoutes } from './bomManagement';
