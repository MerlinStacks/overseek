import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), cache: vi.fn(), remove: vi.fn() }));
vi.mock('../utils/prisma', () => ({ prisma: { user: { findUnique: m.user }, accountUser: { findUnique: m.member } } }));
vi.mock('../utils/cache', () => ({ cacheAside: m.cache, cacheDelete: m.remove }));
vi.mock('../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn() } }));
import { PermissionService } from './PermissionService';
beforeEach(() => { vi.clearAllMocks(); m.user.mockResolvedValue({ isSuperAdmin: false }); m.member.mockResolvedValue({ role: 'MEMBER', maxRole: { permissions: { read: true } }, permissions: {} }); });
it('observes revocation on the next decision without consulting cached grants', async () => {
    m.cache.mockResolvedValue({ '*': true }); expect(await PermissionService.hasPermission('u', 'a', 'read')).toBe(true);
    m.member.mockResolvedValue({ role: 'MEMBER', maxRole: { permissions: { read: false } }, permissions: {} }); expect(await PermissionService.hasPermission('u', 'a', 'read')).toBe(false); expect(m.cache).not.toHaveBeenCalled();
});
it('rejects inherited and truthy invalid grants, preserves explicit owner access and fails closed', async () => {
    m.member.mockResolvedValue({ role: 'MEMBER', permissions: { '*': 'true' } }); expect(await PermissionService.hasPermission('u', 'a', 'constructor')).toBe(false);
    m.member.mockResolvedValue({ role: 'OWNER' }); expect(await PermissionService.hasPermission('u', 'a', 'read')).toBe(true);
    m.user.mockRejectedValue(Error('database unavailable')); expect(await PermissionService.hasPermission('u', 'a', 'read')).toBe(false);
});
it('legacy cache cleanup failures do not misreport an already committed revocation', async () => { m.remove.mockRejectedValue(Error('offline')); await expect(PermissionService.invalidatePermissions('u', 'a')).resolves.toBeUndefined(); });
