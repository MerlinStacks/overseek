import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: { id: 'user-a', isSuperAdmin: false }, token: 'token' as string | null, account: { id: 'account-a' }, permissions: {} as Record<string, unknown> }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: m.user, token: m.token }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account, activePermissions: m.permissions }) }));
import { usePermissions } from './usePermissions';
import { useSavedViews } from './useSavedViews';
beforeEach(() => { localStorage.clear(); m.user = { id: crypto.randomUUID(), isSuperAdmin: false }; m.token = 'token'; m.account = { id: crypto.randomUUID() }; m.permissions = {}; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('only grants own boolean permissions, including wildcard', () => {
    m.permissions = Object.assign(Object.create({ inherited: true }), { read: true, write: 'true', '*': 'false' });
    const { result, rerender } = renderHook(() => usePermissions());
    expect(result.current.hasPermission('read')).toBe(true);
    for (const name of ['constructor', '__proto__', 'write', 'inherited']) expect(result.current.hasPermission(name)).toBe(false);
    m.permissions = { '*': true }; rerender(); expect(result.current.hasPermission('write')).toBe(true);
});
it('keeps stable snapshots, isolates owners, rejects stale callbacks and restores local presets', () => {
    const firstOwner = m.user.id; const { result, rerender } = renderHook(({ context }) => useSavedViews(context), { initialProps: { context: 'orders' } });
    const initial = result.current.views; rerender({ context: 'orders' }); expect(result.current.views).toBe(initial);
    let id = ''; act(() => { id = result.current.saveCurrentView('My orders', { status: 'pending' })!.id; });
    expect(result.current.views).toHaveLength(1); expect(result.current.activeView?.id).toBe(id);
    const oldSave = result.current.saveCurrentView; m.user = { ...m.user, id: 'another-owner' }; rerender({ context: 'orders' });
    expect(result.current.views).toHaveLength(0); act(() => { expect(oldSave('Late', {})).toBeNull(); });
    m.user = { ...m.user, id: firstOwner }; rerender({ context: 'customers' });
    expect(result.current.views).toHaveLength(0); act(() => result.current.applyView(id)); expect(result.current.activeView).toBeNull();
    rerender({ context: 'orders' }); expect(result.current.views).toHaveLength(1);
    act(() => result.current.renameView(id, 'Renamed')); expect(result.current.activeView?.name).toBe('Renamed');
    act(() => result.current.removeView(id)); expect(result.current.activeView).toBeNull();
});
it('does not read legacy unowned data or mutate while signed out', () => {
    localStorage.setItem(`overseek-saved-views-${m.account.id}`, JSON.stringify({ state: { views: [{}] } }));
    m.token = null; const { result } = renderHook(() => useSavedViews('orders'));
    expect(result.current.views).toEqual([]); act(() => { expect(result.current.saveCurrentView('Test', {})).toBeNull(); }); expect(localStorage.length).toBe(1);
});
it('rejects corrupt persisted filters and survives storage failures', () => {
    const key = `overseek-saved-views:v2:${JSON.stringify([m.user.id, m.account.id])}`;
    localStorage.setItem(key, JSON.stringify({ version: 2, views: [null], activeViewId: {} }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    const { result } = renderHook(() => useSavedViews('orders'));
    expect(result.current.views).toEqual([]); expect(result.current.persistenceError).toBeTruthy();
    act(() => { result.current.saveCurrentView('Memory', { a: 1 }); }); expect(result.current.views).toHaveLength(1); expect(result.current.persistenceError).toBeTruthy();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    act(() => { expect(result.current.saveCurrentView('Invalid', cyclic)).toBeNull(); });
    act(() => { expect(result.current.saveCurrentView('Invalid date container', new Date() as unknown as Record<string, unknown>)).toBeNull(); });
});
