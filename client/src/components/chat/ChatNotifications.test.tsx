import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' }, handlers: new Map<string, (data: unknown) => void>(), notifications: [] as Array<{ close: ReturnType<typeof vi.fn>; onclick: unknown }>, calls: vi.fn(), socket: { on: vi.fn(), off: vi.fn() } }));
vi.mock('../../context/SocketContext', () => ({ useSocket: () => ({ socket: m.socket }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
import { ChatNotifications } from './ChatNotifications';
function Page() { return <MemoryRouter><ChatNotifications /></MemoryRouter>; }
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); m.account = { id: 'a' }; m.handlers.clear(); m.notifications.length = 0;
    m.socket.on.mockImplementation((name, fn) => m.handlers.set(name, fn)); m.socket.off.mockImplementation(name => m.handlers.delete(name));
    localStorage.setItem('inbox_notification_rules', JSON.stringify({ quietHoursEnabled: false }));
    vi.stubGlobal('Notification', class { static permission = 'granted'; close = vi.fn(); onclick = null; onclose = null; constructor(title: string, options: unknown) { m.calls(title, options); m.notifications.push(this); } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
const message = { accountId: 'a', conversationId: 'conversation', type: 'CUSTOMER', content: 'Private content' };
describe('notification scope lifecycle', () => {
    it('rejects snooze events without matching account ownership', () => {
        render(<Page />); const send = m.handlers.get('snooze:expired')!;
        act(() => {
            send({ conversationId: 'conversation' });
            send({ accountId: 'other', conversationId: 'conversation' });
            send({ accountId: 'a', conversationId: 'conversation', assignedToId: 'someone-else' });
        });
        expect(m.calls).not.toHaveBeenCalled();
        act(() => { send({ accountId: 'a', conversationId: 'conversation', assignedToId: 'user' }); });
        expect(m.calls).toHaveBeenCalledOnce();
    });
    it('survives browsers that expose but disallow the notification constructor', () => {
        vi.stubGlobal('Notification', class { static permission = 'granted'; constructor() { throw new Error('Unsupported'); } });
        render(<Page />);
        expect(() => act(() => { m.handlers.get('message:new')!({ ...message, priority: 'HIGH' }); })).not.toThrow();
    });
    it('ignores missing and foreign account context', () => {
        render(<Page />); const send = m.handlers.get('message:new')!;
        act(() => { send({ ...message, accountId: undefined, priority: 'HIGH' }); send({ ...message, accountId: 'other', priority: 'HIGH' }); }); expect(m.calls).not.toHaveBeenCalled();
    });
    it('discards queued messages and closes existing notifications on account changes', () => {
        const view = render(<Page />); act(() => { m.handlers.get('message:new')!({ ...message, priority: 'HIGH' }); m.handlers.get('message:new')!(message); });
        expect(m.calls).toHaveBeenCalledOnce(); m.account = { id: 'b' }; view.rerender(<Page />); act(() => { vi.advanceTimersByTime(12000); });
        expect(m.calls).toHaveBeenCalledOnce(); expect(m.notifications[0].close).toHaveBeenCalled(); expect(m.notifications[0].onclick).toBeNull();
    });
    it('cleans all notification timers on unmount and supports browsers without the API', () => {
        const view = render(<Page />); act(() => { vi.runOnlyPendingTimers(); });
        act(() => { m.handlers.get('message:new')!({ ...message, priority: 'HIGH' }); });
        expect(vi.getTimerCount()).toBe(1); view.unmount(); expect(vi.getTimerCount()).toBe(0);
        vi.stubGlobal('Notification', undefined); expect(() => render(<Page />)).not.toThrow();
    });
});
