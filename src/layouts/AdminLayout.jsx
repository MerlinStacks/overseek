import React from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar';
import ErrorBoundary from '../components/ErrorBoundary';
import './AdminLayout.css';

const AdminLayout = () => {
    return (
        <div className="admin-layout">
            <AdminSidebar />
            <main className="admin-content">
                <div className="content-area" style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
                    <ErrorBoundary>
                        <Outlet />
                    </ErrorBoundary>
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
