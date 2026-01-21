/**
 * Chat Routes - Modular Index
 * 
 * Composes all chat-related route modules into a single plugin.
 * This replaces the monolithic chat.ts with maintainable sub-modules.
 * 
 * Module Structure:
 * - cannedResponses.ts: Canned response templates and labels
 * - macros.ts: Inbox automation macros
 * - blockedContacts.ts: Block/unblock contact management
 * - bulkActions.ts: Bulk operations on conversations
 * 
 * Core conversation routes remain in chat.ts for now and will be
 * migrated incrementally.
 */

export { cannedResponseRoutes } from './cannedResponses';
export { macroRoutes } from './macros';
export { blockedContactRoutes } from './blockedContacts';
export { createBulkActionRoutes } from './bulkActions';
