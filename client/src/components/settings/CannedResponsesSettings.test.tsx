import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: { id: 'a' }, fetch: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: mocks.account }) }));
vi.mock('../ui/Toast', () => ({ Toast: ({ isVisible, message, type }: { isVisible: boolean; message: string; type: string }) => isVisible ? <p role={type === 'error' ? 'alert' : 'status'}>{message}</p> : null }));
vi.mock('./CannedResponseForm', () => ({ CannedResponseForm: ({ formData, onFormChange, onSave }: { formData: { shortcut: string; content: string; labelId: string }; onFormChange: (data: unknown) => void; onSave: () => void }) => <div>
    <input aria-label="Shortcut" value={formData.shortcut} onChange={event => onFormChange({ ...formData, shortcut: event.target.value, content: 'Response' })} />
    <button type="button" onClick={onSave}>Save response</button></div> }));
vi.mock('./CannedResponseList', () => ({ CannedResponseList: ({ groups, onDelete }: { groups: Array<{ name: string; items: Array<{ id: string; shortcut: string }> }>; onDelete: (id: string) => void }) => <div>{groups.map(group => <div key={group.name}>{group.name}{group.items.map(item => <button key={item.id} onClick={() => onDelete(item.id)}>Delete {item.shortcut}</button>)}</div>)}</div> }));
vi.mock('./CannedResponseLabelManager', () => ({ CannedResponseLabelManager: ({ onUpdateLabel, onDeleteLabel }: { onUpdateLabel: (id: string, name: string, color: string) => void; onDeleteLabel: (id: string) => void }) => <div><button onClick={() => onUpdateLabel('label', 'Name', '#123456')}>Update label</button><button onClick={() => onDeleteLabel('label')}>Delete label</button></div> }));
import { CannedResponsesSettings } from './CannedResponsesSettings';
const response = { id: 'response', shortcut: 'hello', content: 'Hello', labelId: 'label', label: { id: 'label', name: '__proto__', color: '#123456' } };
beforeEach(() => {
    vi.resetAllMocks(); mocks.account = { id: 'a' }; vi.stubGlobal('fetch', mocks.fetch); vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.fetch.mockImplementation(async (url: string, options: RequestInit) => ({ ok: true, json: async () => options.method ? {} : url.endsWith('canned-labels') ? [response.label] : [response] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('canned response account isolation and mutations', () => {
    it('groups labels safely even when their names match object prototype properties', async () => {
        render(<CannedResponsesSettings />); expect(await screen.findByText('__proto__')).toBeInTheDocument();
    });
    it('reports failed deletions and label updates rather than treating them as successful', async () => {
        render(<CannedResponsesSettings />); await screen.findByRole('button', { name: 'Delete hello' });
        const original = mocks.fetch.getMockImplementation()!;
        mocks.fetch.mockImplementation((url: string, options: RequestInit) => options.method ? Promise.resolve({ ok: false, json: async () => ({ error: 'Server rejected change' }) }) : original(url, options));
        fireEvent.click(screen.getByRole('button', { name: 'Delete hello' })); await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server rejected change'));
        expect(screen.getByRole('button', { name: 'Delete hello' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Manage Labels' })); fireEvent.click(screen.getByRole('button', { name: 'Update label' }));
        await waitFor(() => expect(mocks.fetch.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(true));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server rejected change'));
    });
    it('guards duplicate saves while keeping draft text on failure', async () => {
        render(<CannedResponsesSettings />); await screen.findByText('__proto__');
        fireEvent.change(screen.getByLabelText('Shortcut'), { target: { value: 'draft' } });
        let resolve!: (value: unknown) => void; mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        const button = screen.getByRole('button', { name: 'Save response' }); fireEvent.click(button); fireEvent.click(button);
        expect(mocks.fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
        await act(async () => { resolve({ ok: false, json: async () => ({ error: 'Not saved' }) }); });
        expect(screen.getByRole('alert')).toHaveTextContent('Not saved'); expect(screen.getByLabelText('Shortcut')).toHaveValue('draft');
    });
    it('clears drafts and aborts old requests when changing accounts', async () => {
        const view = render(<CannedResponsesSettings />); await screen.findByText('__proto__');
        fireEvent.change(screen.getByLabelText('Shortcut'), { target: { value: 'private draft' } });
        let resolve!: (value: unknown) => void; mocks.fetch.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        fireEvent.click(screen.getByRole('button', { name: 'Save response' })); const signal = mocks.fetch.mock.calls.at(-1)![1].signal;
        mocks.account = { id: 'b' }; view.rerender(<CannedResponsesSettings />);
        await act(async () => { resolve({ ok: true, json: async () => ({}) }); });
        expect(signal.aborted).toBe(true); expect(screen.getByLabelText('Shortcut')).toHaveValue(''); expect(screen.queryByText('Canned response saved')).toBeNull();
    });
});
