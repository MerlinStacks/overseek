
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AccountProvider, useAccount } from './context/AccountContext';
import { SocketProvider } from './context/SocketContext';
import { SyncStatusProvider } from './context/SyncStatusContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { AdminLayout } from './components/layout/AdminLayout';
import { SuperAdminGuard } from './components/layout/SuperAdminGuard';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SetupWizard } from './pages/SetupWizard';
import { SettingsPage } from './pages/SettingsPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { MarketingPage } from './pages/MarketingPage';
import { TeamPage } from './pages/TeamPage';
import { InventoryPage } from './pages/InventoryPage';
import { CustomersPage } from './pages/CustomersPage';
import { SegmentsPage } from './pages/SegmentsPage';
import { CustomerDetailsPage } from './pages/CustomerDetailsPage';
import { ReportsPage } from './pages/ReportsPage';
import { InboxPage } from './pages/InboxPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { HelpCenterHome } from './pages/HelpCenter/HelpCenterHome';
import { HelpArticle } from './pages/HelpCenter/HelpArticle';
import { LiveAnalyticsPage } from './pages/LiveAnalyticsPage';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import { ProductEditPage } from './pages/ProductEditPage';
import { PurchaseOrderEditPage } from './pages/PurchaseOrderEditPage';
import { InvoiceDesigner } from './pages/InvoiceDesigner';

import { UserProfilePage } from './pages/UserProfilePage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminAccountsPage } from './pages/admin/AdminAccountsPage';
import { AdminLogsPage } from './pages/admin/AdminLogsPage';
import { AdminBroadcastPage } from './pages/admin/AdminBroadcastPage';
import { AdminHelpCenterPage } from './pages/admin/AdminHelpCenterPage';

// Component to handle redirection based on account status
// Component to ensure account exists/is selected
function AccountGuard({ children }: { children: React.ReactNode }) {
    const { accounts, isLoading } = useAccount();

    if (isLoading) return <div>Loading...</div>;

    // If no accounts, force the wizard
    if (accounts.length === 0) {
        return <Navigate to="/setup" replace />;
    }

    return <>{children}</>;
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AccountProvider>
                    <SocketProvider>
                        <SyncStatusProvider>
                            <Routes>
                                {/* Public Routes */}
                                <Route path="/login" element={<LoginPage />} />
                                <Route path="/register" element={<RegisterPage />} />

                                {/* Protected Routes */}
                                <Route element={<ProtectedRoute />}>
                                    <Route path="/setup" element={<SetupWizard />} />

                                    {/* Super Admin Routes */}
                                    <Route element={<SuperAdminGuard><AdminLayout><Outlet /></AdminLayout></SuperAdminGuard>}>
                                        <Route path="/admin" element={<AdminDashboard />} />
                                        <Route path="/admin/accounts" element={<AdminAccountsPage />} />
                                        <Route path="/admin/logs" element={<AdminLogsPage />} />
                                        <Route path="/admin/broadcast" element={<AdminBroadcastPage />} />
                                        <Route path="/admin/help" element={<AdminHelpCenterPage />} />
                                    </Route>

                                    <Route element={<DashboardLayout><Outlet /></DashboardLayout>}>
                                        <Route path="/" element={<AccountGuard><DashboardPage /></AccountGuard>} />
                                        <Route path="/orders" element={<AccountGuard><OrdersPage /></AccountGuard>} />
                                        <Route path="/orders/:id" element={<AccountGuard><OrderDetailPage /></AccountGuard>} />
                                        <Route path="/inventory" element={<AccountGuard><InventoryPage /></AccountGuard>} />
                                        <Route path="/inventory/product/:id" element={<AccountGuard><ProductEditPage /></AccountGuard>} />
                                        <Route path="/inventory/purchase-orders/new" element={<AccountGuard><PurchaseOrderEditPage /></AccountGuard>} />
                                        <Route path="/inventory/purchase-orders/:id" element={<AccountGuard><PurchaseOrderEditPage /></AccountGuard>} />
                                        <Route path="/customers" element={<AccountGuard><CustomersPage /></AccountGuard>} />
                                        <Route path="/customers/segments" element={<AccountGuard><SegmentsPage /></AccountGuard>} />
                                        <Route path="/customers/:id" element={<AccountGuard><CustomerDetailsPage /></AccountGuard>} />
                                        <Route path="/marketing" element={<AccountGuard><MarketingPage /></AccountGuard>} />
                                        <Route path="/inbox" element={<AccountGuard><InboxPage /></AccountGuard>} />
                                        <Route path="/live" element={<AccountGuard><LiveAnalyticsPage /></AccountGuard>} />
                                        <Route path="/analytics" element={<AccountGuard><AnalyticsDashboard /></AccountGuard>} />
                                        <Route path="/reviews" element={<AccountGuard><ReviewsPage /></AccountGuard>} />
                                        <Route path="/help" element={<AccountGuard><HelpCenterHome /></AccountGuard>} />
                                        <Route path="/help/article/:slug" element={<AccountGuard><HelpArticle /></AccountGuard>} />

                                        <Route path="/reports" element={<AccountGuard><ReportsPage /></AccountGuard>} />
                                        <Route path="/team" element={<AccountGuard><TeamPage /></AccountGuard>} />
                                        <Route path="/wizard" element={<AccountGuard><SetupWizard /></AccountGuard>} />
                                        <Route path="/settings" element={<AccountGuard><SettingsPage /></AccountGuard>} />
                                        <Route path="/profile" element={<AccountGuard><UserProfilePage /></AccountGuard>} />

                                        <Route path="/invoices/design" element={<AccountGuard><InvoiceDesigner /></AccountGuard>} />
                                        <Route path="/invoices/design/:id" element={<AccountGuard><InvoiceDesigner /></AccountGuard>} />
                                    </Route>
                                </Route>

                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Routes>
                        </SyncStatusProvider>
                    </SocketProvider>
                </AccountProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
