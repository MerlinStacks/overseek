import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
    Shield,
    Users,
    FileText,
    ArrowLeft,
    LayoutDashboard,
    Wrench
} from 'lucide-react';
import '../layouts/DashboardLayout.css'; // Reuse basic styles
import '../layouts/AdminLayout.css'; // Admin specific overrides

const AdminSidebar = () => {
    return (
        <aside className="admin-sidebar">
            <div className="logo-container">
                <div className="logo-icon" style={{ background: '#ef4444' }}>A</div>
                <span className="logo-text">Admin Panel</span>
            </div>

            <nav className="nav-menu">
                <div className="nav-group">
                    <NavLink to="/admin" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <LayoutDashboard size={20} />
                        <span>Overview</span>
                    </NavLink>

                    <NavLink to="/admin/accounts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <Users size={20} />
                        <span>Accounts</span>
                    </NavLink>

                    <NavLink to="/admin/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <FileText size={20} />
                        <span>System Logs</span>
                    </NavLink>

                    <NavLink to="/admin/tools" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <Wrench size={20} />
                        <span>Tools</span>
                    </NavLink>
                </div>

                <div className="nav-group" style={{ marginTop: 'auto' }}>
                    <NavLink to="/" className="nav-item">
                        <ArrowLeft size={20} />
                        <span>Back to Dashboard</span>
                    </NavLink>
                </div>
            </nav>
        </aside>
    );
};

export default AdminSidebar;
