import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), account: { id: 'account' }, active: true, hasDraft: false, edits: 0 }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../components/marketing/AutomationsList', () => ({ AutomationsList: ({ onEdit }: any) => <button onClick={() => onEdit('flow', 'Order flow')}>Edit flow</button> }));
vi.mock('../components/marketing/FlowBuilder', () => ({ FlowBuilder: ({ initialFlow, onFlowChange }: any) => <button onClick={() => {
    mocks.edits += 1;
    onFlowChange({ ...initialFlow, nodes: initialFlow.nodes.map((node: any) => ({ ...node, data: { ...node.data, label: `${node.data.label} edited${mocks.edits > 1 ? ` ${mocks.edits}` : ''}` } })) });
}}>Change draft</button> }));
import { FlowsPage } from './FlowsPage';
const flow = { nodes: [{ id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Order created', config: { triggerType: 'ORDER_CREATED' } } }, { id: 'exit', type: 'action', position: { x: 0, y: 100 }, data: { label: 'Exit', config: { actionType: 'EXIT' } } }], edges: [{ id: 'edge', source: 'trigger', target: 'exit' }] };
beforeEach(() => {
    window.localStorage.clear(); mocks.fetch.mockReset(); mocks.active = true; mocks.hasDraft = false; mocks.edits = 0; vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.fetch.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/workspace') ? { id: 'flow', name: 'Order flow', isActive: mocks.active, draftRevision: 2, hasUnpublishedChanges: mocks.hasDraft, flowDefinition: flow } : url.endsWith('/draft') ? { draftRevision: 3, hasUnpublishedChanges: true } : url.endsWith('/publish') ? { draftRevision: 4, hasUnpublishedChanges: false } : url.includes('/node-stats') ? {} : url.endsWith('/analytics') ? null : [] }));
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
it('uses one toggle to disable, then save/publish the latest revision before re-enabling', async () => {
    await renderEditor(); fireEvent.click(screen.getByText('Change draft'));
    expect(screen.queryByRole('button', { name: 'Review & publish draft' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Flow enabled' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(true));
    const call = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/publish'))!;
    expect(JSON.parse(call[1].body)).toEqual({ revision: 3 });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Publish the latest draft and enable'));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    const writes = mocks.fetch.mock.calls.filter(([url]) => /\/(?:draft|publish|status)$/.test(url));
    expect(writes.map(([url]) => url.split('/').pop())).toEqual(['status', 'draft', 'publish', 'status']);
    expect(JSON.parse(writes[0][1].body)).toEqual({ isActive: false });
    expect(JSON.parse(writes[3][1].body)).toEqual({ isActive: true });
});
it('does not save, publish or enable when the operator cancels', async () => {
    mocks.active = false; mocks.hasDraft = true;
    await renderEditor(); vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole('switch', { name: 'Flow enabled' }));
    expect(mocks.fetch.mock.calls.some(([url]) => /\/(?:draft|publish|status)$/.test(url))).toBe(false);
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', 'false');
});
it('enables an unchanged published flow without publishing a new revision', async () => {
    mocks.active = false;
    await renderEditor();
    fireEvent.click(screen.getByRole('switch', { name: 'Flow enabled' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', 'true'));
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish') || url.endsWith('/draft'))).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Enable the published flow'));
});
it('keeps the flow disabled when publication fails', async () => {
    mocks.active = false; mocks.hasDraft = true;
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/publish') ? Promise.resolve({ ok: false, json: async () => ({ error: 'Draft revision conflict' }) }) : original(url, ...args));
    await renderEditor();
    fireEvent.click(screen.getByRole('switch', { name: 'Flow enabled' }));
    await screen.findByText('Draft revision conflict');
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', 'false');
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(false);
});
it('retains the previous toggle state when a status update fails', async () => {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/status') ? Promise.resolve({ ok: false, json: async () => ({ error: 'Status update failed' }) }) : original(url, ...args));
    await renderEditor();
    fireEvent.click(screen.getByRole('switch', { name: 'Flow enabled' }));
    await screen.findByText('Status update failed');
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', 'true');
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(false);
});
it('retains blocking validation before publishing or enabling', async () => {
    mocks.active = false; mocks.hasDraft = true;
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url, ...args) => {
        const response = await original(url, ...args);
        if (!url.endsWith('/workspace')) return response;
        return { ok: true, json: async () => ({ ...await response.json(), flowDefinition: { nodes: [flow.nodes[1]], edges: [] } }) };
    });
    await renderEditor();
    fireEvent.click(screen.getByRole('switch', { name: 'Flow enabled' }));
    await screen.findByText('Flow needs a trigger before it can run.');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.some(([url]) => /\/(?:draft|publish|status)$/.test(url))).toBe(false);
});
it('does not publish or enable after a failed save', async () => {
    mocks.active = false;
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/draft') ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Offline' }) }) : original(url, ...args));
    await renderEditor(); fireEvent.click(screen.getByText('Change draft'));
    fireEvent.click(screen.getByRole('switch', { name: 'Flow enabled' }));
    await screen.findByText('Save the latest flow changes before enabling it.');
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', 'false');
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish') || url.endsWith('/status'))).toBe(false);
});
it('blocks duplicate toggles and refuses activation if the draft changes during publication', async () => {
    mocks.active = false; mocks.hasDraft = true;
    let finish!: (result: unknown) => void;
    const publish = new Promise(resolve => { finish = resolve; });
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/publish') ? publish : original(url, ...args));
    await renderEditor();
    const toggle = screen.getByRole('switch', { name: 'Flow enabled' });
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(true));
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('Change draft'));
    finish({ ok: true, json: async () => ({ draftRevision: 4, hasUnpublishedChanges: false }) });
    await screen.findByText('Draft changed while publishing. Review it and enable the flow again.');
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/publish'))).toHaveLength(1);
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
});

it.each([true, false])('saves and publishes edits without changing active status (%s)', async (active) => {
    mocks.active = active;
    await renderEditor();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(screen.getByText('Change draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved and published. Flow status unchanged.');
    const writes = mocks.fetch.mock.calls.filter(([url]) => /\/(?:draft|publish|status)$/.test(url));
    expect(writes.map(([url]) => url.split('/').pop())).toEqual(['draft', 'publish']);
    expect(JSON.parse(writes[0][1].body)).toMatchObject({ revision: 2, flowDefinition: { nodes: [expect.objectContaining({ data: expect.objectContaining({ label: 'Order created edited' }) }), expect.anything()] } });
    expect(JSON.parse(writes[1][1].body)).toEqual({ revision: 3 });
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', String(active));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

it('publishes an already autosaved draft without rewriting it', async () => {
    mocks.hasDraft = true;
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved and published. Flow status unchanged.');
    const writes = mocks.fetch.mock.calls.filter(([url]) => /\/(?:draft|publish|status)$/.test(url));
    expect(writes.map(([url]) => url.split('/').pop())).toEqual(['publish']);
    expect(JSON.parse(writes[0][1].body)).toEqual({ revision: 2 });
});

it('preserves existing email layouts, design data and delivery settings when saving', async () => {
    const config = {
        actionType: 'SEND_EMAIL', subject: 'Your order update',
        htmlContent: '<table style="background:#fafafa"><tr><td>{{customer.first_name}}</td></tr></table>',
        designJson: { sections: [{ id: 'existing-section', columns: [] }], custom: 'preserve existing design' },
        senderName: 'Support', replyTo: 'support@example.invalid', emailCategory: 'TRANSACTIONAL',
        appendUtm: false,
    };
    const emailFlow = { ...flow, nodes: [flow.nodes[0], { ...flow.nodes[1], data: { label: 'Email', config } }] };
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/workspace')
        ? Promise.resolve({ ok: true, json: async () => ({ id: 'flow', isActive: true, draftRevision: 2, flowDefinition: emailFlow }) })
        : original(url, ...args));
    await renderEditor();
    fireEvent.click(screen.getByText('Change draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved and published. Flow status unchanged.');
    const save = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/draft'))!;
    expect(JSON.parse(save[1].body).flowDefinition.nodes[1].data.config).toEqual(config);
});

it('does not publish or discard draft edits when save confirmation is cancelled', async () => {
    mocks.hasDraft = true;
    await renderEditor();
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(mocks.fetch.mock.calls.some(([url]) => /\/(?:publish|status)$/.test(url))).toBe(false);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByText(/Unpublished changes/)).toBeInTheDocument();
});

it('blocks publishing an invalid draft without changing the live flow', async () => {
    mocks.hasDraft = true;
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url, ...args) => {
        if (!url.endsWith('/workspace')) return original(url, ...args);
        return { ok: true, json: async () => ({ id: 'flow', isActive: true, draftRevision: 2, hasUnpublishedChanges: true, flowDefinition: { nodes: [flow.nodes[1]], edges: [] } }) };
    });
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Flow needs a trigger before it can run.');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.some(([url]) => /\/(?:draft|publish|status)$/.test(url))).toBe(false);
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', 'true');
});

it('retains local edits and the enabled state if draft saving fails', async () => {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/draft') ? Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Offline' }) }) : original(url, ...args));
    await renderEditor();
    fireEvent.click(screen.getByText('Change draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Could not save the latest draft. Your changes are kept; the published flow has not changed.');
    expect(mocks.fetch.mock.calls.some(([url]) => /\/(?:publish|status)$/.test(url))).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('overseek-flow-draft:account:flow')!).flowDefinition.nodes[0].data.label).toBe('Order created edited');
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toHaveAttribute('aria-checked', 'true');
});

it('keeps a conflicting draft available without toggling the live flow', async () => {
    mocks.hasDraft = true;
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/publish') ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'Draft revision conflict' }) }) : original(url, ...args));
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Draft revision conflict');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByText(/Unpublished changes/)).toBeInTheDocument();
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(false);
});

it('locks save and status actions during publication and preserves newer edits', async () => {
    mocks.hasDraft = true;
    let finish!: (result: unknown) => void;
    const publish = new Promise(resolve => { finish = resolve; });
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/publish') ? publish : original(url, ...args));
    await renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/publish'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Saving changes...' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Flow enabled' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Saving changes...' }));
    fireEvent.click(screen.getByText('Change draft'));
    await act(async () => { finish({ ok: true, json: async () => ({ draftRevision: 3, hasUnpublishedChanges: false }) }); });
    await screen.findByText('Reviewed changes published. Newer edits are still a draft; save changes again to publish them.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(JSON.parse(window.localStorage.getItem('overseek-flow-draft:account:flow')!).flowDefinition.nodes[0].data.label).toBe('Order created edited');
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/publish'))).toHaveLength(1);
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/status'))).toBe(false);
});

it('refuses publication when the draft changes while saving the reviewed edits', async () => {
    let finish!: (result: unknown) => void;
    const save = new Promise(resolve => { finish = resolve; });
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((url, ...args) => url.endsWith('/draft') ? save : original(url, ...args));
    await renderEditor();
    fireEvent.click(screen.getByText('Change draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/draft'))).toBe(true));
    fireEvent.click(screen.getByText('Change draft'));
    await act(async () => { finish({ ok: true, json: async () => ({ draftRevision: 3, hasUnpublishedChanges: true }) }); });
    await screen.findByText('Could not save the latest draft. Your changes are kept; the published flow has not changed.');
    expect(mocks.fetch.mock.calls.some(([url]) => /\/(?:publish|status)$/.test(url))).toBe(false);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});
