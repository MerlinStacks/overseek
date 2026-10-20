import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { LoginPage } from '../pages/LoginPage';

const auth = vi.hoisted(() => ({ token: null as string | null, isLoading: false, login: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

function Destination() {
    const location = useLocation();
    const navigate = useNavigate();
    return <>
        <div data-testid="destination">{location.pathname + location.search + location.hash}</div>
        <button onClick={() => navigate(-1)}>Back</button>
    </>;
}

function renderRoutes(entry: string | { pathname: string; state: unknown } = '/orders?status=pending#details') {
    return render(<MemoryRouter initialEntries={['/previous', entry]} initialIndex={1}>
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/previous" element={<div>Previous page</div>} />
            <Route element={<ProtectedRoute />}>
                <Route path="*" element={<Destination />} />
            </Route>
        </Routes>
    </MemoryRouter>);
}

async function signIn() {
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
    auth.token = null;
    auth.isLoading = false;
    auth.login.mockReset();
    auth.login.mockImplementation(() => { auth.token = 'access-token'; });
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'access-token', user: { id: 'user-1' }, refreshToken: 'refresh-token' }),
    }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('protected route login redirects', () => {
    it('announces loading without rendering protected content or redirecting', () => {
        auth.isLoading = true;
        renderRoutes();
        expect(screen.getByRole('status')).toHaveTextContent('Loading...');
        expect(screen.queryByTestId('destination')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
    });

    it('renders authenticated routes without requiring login', () => {
        auth.token = 'access-token';
        renderRoutes();
        expect(screen.getByTestId('destination')).toHaveTextContent('/orders?status=pending#details');
    });

    it('restores the requested path, query and hash after login and replaces the login history entry', async () => {
        renderRoutes();
        expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
        await signIn();
        expect(await screen.findByTestId('destination')).toHaveTextContent('/orders?status=pending#details');
        expect(auth.login).toHaveBeenCalledWith('access-token', { id: 'user-1' }, 'refresh-token');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Previous page')).toBeInTheDocument();
    });

    it.each([
        undefined, null, { from: null }, { from: { pathname: '/orders' } },
        { from: 'https://example.com' }, { from: '//example.com' },
        { from: '/\\example.com' }, { from: '/\n/example.com' },
        { from: '/login' }, { from: '/login/?expired=true' },
    ])('falls back to the dashboard for missing or invalid return state: %j', async state => {
        renderRoutes({ pathname: '/login', state });
        await signIn();
        expect(await screen.findByTestId('destination')).toHaveTextContent('/dashboard');
    });

    it('keeps the user on login when authentication fails', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false, json: async () => ({ error: 'Invalid credentials' }),
        } as Response);
        renderRoutes();
        await signIn();
        await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
        expect(auth.login).not.toHaveBeenCalled();
        expect(screen.queryByTestId('destination')).toBeNull();
    });
});
