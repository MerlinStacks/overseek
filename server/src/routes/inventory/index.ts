/**
 * Inventory Routes - Modular Index
 * 
 * Composes inventory-related route modules into exports.
 * 
 * Module Structure:
 * - suppliers.ts: Supplier CRUD and supplier items
 * - bomSync.ts: BOM inventory sync with WooCommerce
 */

export { supplierRoutes } from './suppliers';
export { bomSyncRoutes } from './bomSync';
