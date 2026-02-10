import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function SuperAdminGuard({ children }: { children?: React.ReactNode }) {
    const { user, isLoading } = useAuth();

    if (isLoading) return <div>Loading...</div>;

    if (!user || !user.isSuperAdmin) {
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children || <Outlet />}</>;
}
