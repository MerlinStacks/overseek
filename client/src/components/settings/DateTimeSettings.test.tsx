import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimeSettings } from './DateTimeSettings';

const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), user: { id: 'user', timezone: 'UTC', dateFormat: 'dmy', timeFormat: '24h' } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, token: 'token', updateUser: mocks.updateUser }) }));

describe('DateTimeSettings', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
    it('loads and saves personal preferences through the profile endpoint', async () => {
        const updated = { ...mocks.user, timezone: 'Australia/Sydney', dateFormat: 'ymd' };
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => updated });
        vi.stubGlobal('fetch', fetch);
        render(<DateTimeSettings />);
        expect(screen.getByLabelText('Time zone')).toHaveValue('UTC');
        fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Australia/Sydney' } });
        fireEvent.change(screen.getByLabelText('Date format'), { target: { value: 'ymd' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save date & time' }));
        await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledWith(updated));
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ timezone: 'Australia/Sydney', dateFormat: 'ymd', timeFormat: '24h' });
        expect(fetch.mock.calls[0][0]).toBe('/api/auth/me');
        expect(await screen.findByRole('status')).toHaveTextContent('preferences saved');
    });
    it('supports automatic timezone and reports save errors without updating the user', async () => {
        const fetch = vi.fn().mockResolvedValue({ ok: false });
        vi.stubGlobal('fetch', fetch);
        render(<DateTimeSettings />);
        fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save date & time' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');
        expect(JSON.parse(fetch.mock.calls[0][1].body).timezone).toBeNull();
        expect(mocks.updateUser).not.toHaveBeenCalled();
    });
});
