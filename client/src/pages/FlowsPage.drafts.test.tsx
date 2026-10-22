import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), account: { id: 'account' } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../components/marketing/AutomationsList', () => ({ AutomationsList: ({ onEdit }: any) => <button onClick={() => onEdit('flow', 'Order flow')}>Edit flow</button> }));
vi.mock('../components/marketing/FlowBuilder', () => ({ FlowBuilder: ({ initialFlow, onFlowChange }: any) => <button onClick={() => onFlowChange({ ...initialFlow, nodes: initialFlow.nodes.map((node: any) => ({ ...node, data: { ...node.data, label: `${node.data.label} edited` } })) })}>Change draft</button> }));
import { FlowsPage } from './FlowsPage';
const flow = { nodes: [{ id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Order created', config: { triggerType: 'ORDER_CREATED' } } }, { id: 'exit', type: 'action', position: { x: 0, y: 100 }, data: { label: 'Exit', config: { actionType: 'EXIT' } } }], edges: [{ id: 'edge', source: 'trigger', target: 'exit' }] };
beforeEach(() => {
    window.localStorage.clear(); mocks.fetch.mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/workspace') ? { id: 'flow', name: 'Order flow', isActive: true, draftRevision: 2, hasUnpublishedChanges: false, flowDefinition: flow } : url.endsWith('/draft') ? { draftRevision: 3, hasUnpublishedChanges: true } : url.endsWith('/publish') ? { draftRevision: 4, hasUnpublishedChanges: false } : url.includes('/node-stats') ? {} : url.endsWith('/analytics') ? null : [] }));
    vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const renderEditor = async () => { render(<MemoryRouter><FlowsPage /></MemoryRouter>); fireEvent.click(screen.getByText('Edit flow')); await screen.findByText('Change draft'); };
it('autosaves exclusively to a revision-checked draft and never updates the live definition', async () => {
    await renderEditor(); fireEvent.click(screen.getByText('Change draft'));
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/draft'))).toBe(true), { timeout: 2500 });
    const call = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/draft'))!;
    expect(call[1].method).toBe('PUT'); expect(JSON.parse(call[1].body)).toMatchObject({ revision: 2, flowDefinition: { nodes: expect.any(Array) } });
    expect(JSON.parse(call[1].body)).not.toHaveProperty('isActive');
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish') || url === '/api/marketing/automations')).toBe(false);
    await screen.findByText('Draft saved'); expect(screen.getByText(/Unpublished changes/)).toBeInTheDocument();
});
it('requires confirmation and publishes the latest saved revision explicitly', async () => {
    await renderEditor(); fireEvent.click(screen.getByText('Change draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish draft' }));
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(true));
    const call = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/publish'))!;
    expect(JSON.parse(call[1].body)).toEqual({ revision: 3 });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('LIVE flow'));
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(false);
});
it('does not publish when the operator cancels the review', async () => {
    await renderEditor(); vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish draft' }));
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(false);
});
