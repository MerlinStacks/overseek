import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ loading: false, admin: false }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { isSuperAdmin: mocks.admin }, isLoading: mocks.loading }) }));
import { SuperAdminGuard } from './SuperAdminGuard';
afterEach(() => { cleanup(); mocks.loading = false; mocks.admin = false; });
function setup(children?: React.ReactNode) {
    render(<MemoryRouter initialEntries={['/admin']}><Routes><Route element={<SuperAdminGuard>{children}</SuperAdminGuard>}><Route path="/admin" element={<p>Admin outlet</p>} /></Route><Route path="/dashboard" element={<p>Dashboard</p>} /></Routes></MemoryRouter>);
}
describe('super admin route guard', () => {
    it('announces loading without rendering protected content', () => { mocks.loading = true; setup(); expect(screen.getByRole('status')).toHaveTextContent('Loading'); expect(screen.queryByText('Admin outlet')).toBeNull(); });
    it('redirects non-admins', () => { setup(); expect(screen.getByText('Dashboard')).toBeInTheDocument(); });
    it('renders an outlet for admins while honoring explicitly false children', () => { mocks.admin = true; setup(false); expect(screen.queryByText('Admin outlet')).toBeNull(); });
    it('renders the outlet when children are absent', () => { mocks.admin = true; setup(); expect(screen.getByText('Admin outlet')).toBeInTheDocument(); });
});
