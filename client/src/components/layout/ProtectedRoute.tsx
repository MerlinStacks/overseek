import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export function ProtectedRoute() {
    const { token, isLoading } = useAuth();
    const location = useLocation();

    if (isLoading) {
        return <div role="status" className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    if (!token) {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
    }

    return <Outlet />;
}
