import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ account: { id: 'a' } as { id: string } | null, token: 'token' as string | null, io: vi.fn() }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ token: m.token }) }));
vi.mock('./AccountContext', () => ({ useAccount: () => ({ currentAccount: m.account }) }));
vi.mock('socket.io-client', () => ({ io: m.io }));
import { SocketProvider, useSocket } from './SocketContext';
function Consumer() { const { socket, isConnected } = useSocket(); return <output>{socket?.id || 'none'}:{String(isConnected)}</output>; }
function socket(id: string) { const listeners = new Map<string, () => void>(); return { id, connected: false, on: vi.fn((name, callback) => listeners.set(name, callback)), off: vi.fn(), disconnect: vi.fn(), emit: vi.fn(), listeners }; }
beforeEach(() => { vi.resetAllMocks(); m.account = { id: 'a' }; m.token = 'token'; });
afterEach(cleanup);
describe('socket scope', () => {
    it('does not reconnect for a new account object with the same ID', async () => {
        const first = socket('first'); m.io.mockReturnValue(first); const view = render(<SocketProvider><Consumer /></SocketProvider>); await screen.findByText('first:false');
        m.account = { id: 'a' }; view.rerender(<SocketProvider><Consumer /></SocketProvider>); expect(m.io).toHaveBeenCalledOnce();
    });
    it('hides old connections immediately and ignores late listeners after switching accounts or logging out', async () => {
        const first = socket('first'); const second = socket('second'); m.io.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const view = render(<SocketProvider><Consumer /></SocketProvider>); await screen.findByText('first:false'); act(() => first.listeners.get('connect')!()); expect(screen.getByText('first:true')).toBeInTheDocument();
        m.account = { id: 'b' }; view.rerender(<SocketProvider><Consumer /></SocketProvider>); expect(screen.queryByText(/first/)).toBeNull(); act(() => first.listeners.get('connect')!()); await screen.findByText('second:false');
        expect(first.disconnect).toHaveBeenCalledOnce(); expect(first.off).toHaveBeenCalledTimes(3);
        m.token = null; view.rerender(<SocketProvider><Consumer /></SocketProvider>); act(() => second.listeners.get('connect')!()); await waitFor(() => expect(screen.getByText('none:false')).toBeInTheDocument());
    });
    it('never publishes a socket from a disposed queued setup', async () => {
        const first = socket('first'); m.io.mockReturnValue(first); const view = render(<SocketProvider><Consumer /></SocketProvider>); view.unmount(); await act(async () => {}); expect(first.disconnect).toHaveBeenCalledOnce();
    });
});
