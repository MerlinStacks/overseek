import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
    BarChart3, DollarSign, GitBranch,
    TrendingUp, Search, LogOut, Download
} from 'lucide-react';
import { DateRangeFilter } from '../components/analytics/DateRangeFilter';

const navItems = [
    { to: '/analytics', label: 'Overview', icon: BarChart3, end: true },
    { to: '/analytics/revenue', label: 'Revenue', icon: DollarSign },
    { to: '/analytics/attribution', label: 'Attribution', icon: GitBranch },
    { to: '/analytics/cohorts', label: 'Cohorts', icon: TrendingUp },
];

interface AnalyticsLayoutProps {
    days: number;
    setDays: (days: number) => void;
}

export const AnalyticsLayout: React.FC<AnalyticsLayoutProps> = ({ days, setDays }) => {
    return (
        <div className="h-full flex flex-col">
            {/* Sub Navigation */}
            <div className="bg-white border-b border-gray-200 px-6 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        {navItems.map(item => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.end}
                                className={({ isActive }) =>
                                    `flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${isActive
                                        ? 'bg-blue-50 text-blue-600'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                    }`
                                }
                            >
                                <item.icon className="w-4 h-4" />
                                {item.label}
                            </NavLink>
                        ))}
                    </div>
                    <div className="flex items-center gap-3">
                        <DateRangeFilter value={days} onChange={setDays} />
                        <a
                            href={`/api/tracking/export?days=${days}`}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Export
                        </a>
                    </div>
                </div>
            </div>

            {/* Page Content */}
            <div className="flex-1 overflow-y-auto bg-gray-50/50">
                <Outlet context={{ days }} />
            </div>
        </div>
    );
};

export default AnalyticsLayout;
