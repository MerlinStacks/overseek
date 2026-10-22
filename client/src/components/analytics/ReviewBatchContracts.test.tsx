import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token', user: { id: 'u' } }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'a' } }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
import { ReportsSidebar } from './ReportsSidebar';
import { EmailTemplateSelectorModal } from '../marketing/flow/EmailTemplateSelectorModal';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('preserves unknown categories and selected templates across search, without inherited-key lookup', () => {
    const template = { id: 'report', type: 'SYSTEM' as const, name: 'Report', category: 'constructor' as any, config: { dimension: 'day', metrics: ['orders'], dateRange: '30d' } };
    render(<ReportsSidebar templates={[template]} selectedTemplateId="report" onSelect={vi.fn()} onDelete={vi.fn()} onCreateCustom={vi.fn()} />);
    expect(screen.getByText('Unknown category')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'different' } });
    expect(screen.getByRole('button', { name: /Report day/ })).toHaveAttribute('aria-pressed', 'true');
});
it('selects bounded template observations only after deliberate acknowledgement', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'template', name: 'Saved email', subject: null, content: '<p>Synthetic</p>', designJson: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]))));
    vi.spyOn(window, 'confirm').mockReturnValue(true); const close = vi.fn(), select = vi.fn().mockResolvedValue(false);
    render(<EmailTemplateSelectorModal onClose={close} onSelect={select} />);
    fireEvent.click(await screen.findByRole('button', { name: /Saved email/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not acknowledged'); expect(close).not.toHaveBeenCalled(); expect(select).toHaveBeenCalledOnce();
});
