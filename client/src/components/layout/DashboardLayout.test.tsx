import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardLayout } from './DashboardLayout';
import { Sidebar } from './Sidebar';

const { mobile } = vi.hoisted(() => ({ mobile: { value: true } }));
vi.mock('../../hooks/useMobile', () => ({ useMobile: () => mobile.value }));
vi.mock('../../hooks/usePrefetch', () => ({ usePrefetch: () => ({ prefetch: vi.fn() }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock('../../hooks/useAccountFeature', () => ({ useAccountFeature: () => true }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: null }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../../context/SocketContext', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('./AccountSwitcher', () => ({ AccountSwitcher: () => <button>Switch account</button> }));
vi.mock('./SidebarSyncStatus', () => ({ SidebarSyncStatus: () => null }));
vi.mock('./Header', () => ({ Header: ({ onMenuClick }: { onMenuClick: () => void }) => <button onClick={onMenuClick}>Open navigation</button> }));
vi.mock('../ai/AIChatWidget', () => ({ AIChatWidget: () => null }));
vi.mock('../chat/ChatNotifications', () => ({ ChatNotifications: () => null }));
vi.mock('../ui/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../hooks/useCommandPalette', () => ({ CommandPaletteProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('./ThemeInjector', () => ({ ThemeInjector: () => null }));

afterEach(() => {
    cleanup();
    mobile.value = true;
    vi.useRealTimers();
});

it('keeps the layout drawer open, traps focus, and restores focus and background on Escape', async () => {
    vi.useFakeTimers();
    const { container } = render(<MemoryRouter><DashboardLayout><button>Page action</button></DashboardLayout></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    trigger.focus();
    fireEvent.click(trigger);
    await act(async () => vi.advanceTimersByTimeAsync(10));
    const dialog = screen.getByRole('dialog', { name: 'Main navigation' });
    const close = within(dialog).getByRole('button', { name: 'Close navigation' });
    expect(close).toHaveFocus();
    expect(container.inert).toBe(true);
    expect(container).toHaveAttribute('aria-hidden', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    const last = within(dialog).getByRole('link', { name: 'Settings' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    trigger.focus();
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(container.inert).not.toBe(true);
    expect(container).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('');
});

it('ignores inline onClose identity changes but closes on navigation and the close button', () => {
    function Harness() {
        const [open, setOpen] = useState(true);
        return <><button onClick={() => setOpen(true)}>Reopen</button><Sidebar isMobile isOpen={open} onClose={() => setOpen(false)} /></>;
    }
    const { rerender } = render(<MemoryRouter><Harness /></MemoryRouter>);
    rerender(<MemoryRouter><Harness /></MemoryRouter>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Inbox' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('closes on backdrop click and restores focus when switching to desktop', () => {
    const tree = () => <MemoryRouter><DashboardLayout>Content</DashboardLayout></MemoryRouter>;
    const { rerender } = render(tree());
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('dialog').previousElementSibling!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    mobile.value = false;
    rerender(tree());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
});
