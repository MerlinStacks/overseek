import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { SharedSections } from './SharedSections';
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../../../context/AccountContext', () => ({ useAccount: () => ({ currentAccount: { id: 'account' } }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('shared section UI', () => {
    it('handles an unexpected library envelope without crashing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
        await act(async () => { render(<SharedSections onInsert={vi.fn()} onLink={vi.fn()} onRefresh={vi.fn()} />); });
        expect(screen.getByText('Brand section library')).toBeInTheDocument();
    });
    it('does not link a completed mutation to a newly selected section', async () => {
        let complete!: (value: any) => void;
        vi.stubGlobal('fetch', vi.fn((_url, options) => options.method === 'POST' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ presets: [] }) })));
        vi.spyOn(window, 'prompt').mockReturnValue('Header');
        const section = createDefaultEmailDesignV2().document.sections[0]; const onLink = vi.fn();
        const props = { onLink, onInsert: vi.fn(), onRefresh: vi.fn() };
        const view = render(<SharedSections {...props} section={section} />);
        fireEvent.click(screen.getByText('Save new library copy'));
        view.rerender(<SharedSections {...props} section={{ ...section, id: 'other' }} />);
        await act(async () => { complete({ ok: true, json: async () => ({ id: 'saved', version: 1, name: 'Header' }) }); });
        expect(onLink).not.toHaveBeenCalled();
    });
});
