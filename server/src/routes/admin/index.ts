/**
 * Admin Routes - Modular Index
 * 
 * Composes all admin-related route modules into exports for use.
 * 
 * Module Structure:
 * - webhooks.ts: Webhook delivery management and replay
 * - platformCredentials.ts: Platform credentials, SMTP, VAPID, AI prompts
 * - geoip.ts: GeoIP database status and updates
 */

export { webhookAdminRoutes } from './webhooks';
export { platformCredentialsRoutes } from './platformCredentials';
export { geoipRoutes } from './geoip';
