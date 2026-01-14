
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import { AccountProvider, useAccount } from './context/AccountContext';
import { SocketProvider } from './context/SocketContext';
import { SyncStatusProvider } from './context/SyncStatusContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { AdminLayout } from './components/layout/AdminLayout';
import { SuperAdminGuard } from './components/layout/SuperAdminGuard';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { DataDeletionPage } from './pages/DataDeletionPage';
import { TermsOfServicePage } from './pages/TermsOfServicePage';
import { SetupWizard } from './pages/SetupWizard';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

// Lazy-loaded core pages (moved from static imports for bundle optimization)
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

// ... (inside App function)


// Lazy-loaded pages (code splitting for bundle optimization)
const OrdersPage = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage').then(m => ({ default: m.OrderDetailPage })));
const MarketingPage = lazy(() => import('./pages/MarketingPage').then(m => ({ default: m.MarketingPage })));
const FlowsPage = lazy(() => import('./pages/FlowsPage').then(m => ({ default: m.FlowsPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then(m => ({ default: m.TeamPage })));
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const SegmentsPage = lazy(() => import('./pages/SegmentsPage').then(m => ({ default: m.SegmentsPage })));
const CustomerDetailsPage = lazy(() => import('./pages/CustomerDetailsPage').then(m => ({ default: m.CustomerDetailsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const InboxPage = lazy(() => import('./pages/InboxPage').then(m => ({ default: m.InboxPage })));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage').then(m => ({ default: m.ReviewsPage })));
const PaidAdsPage = lazy(() => import('./pages/PaidAdsPage').then(m => ({ default: m.PaidAdsPage })));
const AdAIPage = lazy(() => import('./pages/AdAIPage').then(m => ({ default: m.AdAIPage })));
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage').then(m => ({ default: m.BroadcastsPage })));
const HelpCenterHome = lazy(() => import('./pages/HelpCenter/HelpCenterHome').then(m => ({ default: m.HelpCenterHome })));
const HelpArticle = lazy(() => import('./pages/HelpCenter/HelpArticle').then(m => ({ default: m.HelpArticle })));
const LiveAnalyticsPage = lazy(() => import('./pages/LiveAnalyticsPage').then(m => ({ default: m.LiveAnalyticsPage })));
const ProductEditPage = lazy(() => import('./pages/ProductEditPage').then(m => ({ default: m.ProductEditPage })));
const PurchaseOrderEditPage = lazy(() => import('./pages/PurchaseOrderEditPage').then(m => ({ default: m.PurchaseOrderEditPage })));
const InvoiceDesigner = lazy(() => import('./pages/InvoiceDesigner').then(m => ({ default: m.InvoiceDesigner })));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage').then(m => ({ default: m.PoliciesPage })));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage').then(m => ({ default: m.UserProfilePage })));

// Analytics Sub-Pages
const AnalyticsOverviewPage = lazy(() => import('./pages/analytics/AnalyticsOverviewPage').then(m => ({ default: m.AnalyticsOverviewPage })));
const RevenuePage = lazy(() => import('./pages/analytics/RevenuePage').then(m => ({ default: m.RevenuePage })));
const AttributionPage = lazy(() => import('./pages/analytics/AttributionPage').then(m => ({ default: m.AttributionPage })));
const CohortsPage = lazy(() => import('./pages/analytics/CohortsPage').then(m => ({ default: m.CohortsPage })));

// Admin pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminAccountsPage = lazy(() => import('./pages/admin/AdminAccountsPage').then(m => ({ default: m.AdminAccountsPage })));
const AdminLogsPage = lazy(() => import('./pages/admin/AdminLogsPage').then(m => ({ default: m.AdminLogsPage })));
const AdminBroadcastPage = lazy(() => import('./pages/admin/AdminBroadcastPage').then(m => ({ default: m.AdminBroadcastPage })));
const AdminCredentialsPage = lazy(() => import('./pages/admin/AdminCredentialsPage').then(m => ({ default: m.AdminCredentialsPage })));
const AdminAIPromptsPage = lazy(() => import('./pages/admin/AdminAIPromptsPage').then(m => ({ default: m.AdminAIPromptsPage })));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));

// Mobile PWA pages
const MobileLayout = lazy(() => import('./components/layout/MobileLayout').then(m => ({ default: m.MobileLayout })));
const MobileDashboard = lazy(() => import('./pages/mobile/MobileDashboard').then(m => ({ default: m.MobileDashboard })));
const MobileOrders = lazy(() => import('./pages/mobile/MobileOrders').then(m => ({ default: m.MobileOrders })));
const MobileOrderDetail = lazy(() => import('./pages/mobile/MobileOrderDetail').then(m => ({ default: m.MobileOrderDetail })));
const MobileInbox = lazy(() => import('./pages/mobile/MobileInbox').then(m => ({ default: m.MobileInbox })));
const MobileChat = lazy(() => import('./pages/mobile/MobileChat').then(m => ({ default: m.MobileChat })));
const MobileAnalytics = lazy(() => import('./pages/mobile/MobileAnalytics').then(m => ({ default: m.MobileAnalytics })));
const MobileInventory = lazy(() => import('./pages/mobile/MobileInventory').then(m => ({ default: m.MobileInventory })));
const MobileMore = lazy(() => import('./pages/mobile/MobileMore').then(m => ({ default: m.MobileMore })));
const MobileNotifications = lazy(() => import('./pages/mobile/MobileNotifications').then(m => ({ default: m.MobileNotifications })));
const MobileLiveVisitors = lazy(() => import('./pages/mobile/MobileLiveVisitors').then(m => ({ default: m.MobileLiveVisitors })));
const MobileProfile = lazy(() => import('./pages/mobile/MobileProfile').then(m => ({ default: m.MobileProfile })));
const MobileSettings = lazy(() => import('./pages/mobile/MobileSettings').then(m => ({ default: m.MobileSettings })));
const MobileCustomers = lazy(() => import('./pages/mobile/MobileCustomers').then(m => ({ default: m.MobileCustomers })));
const MobileCustomerDetail = lazy(() => import('./pages/mobile/MobileCustomerDetail').then(m => ({ default: m.MobileCustomerDetail })));
const MobileVisitorDetail = lazy(() => import('./pages/mobile/MobileVisitorDetail').then(m => ({ default: m.MobileVisitorDetail })));

// Loading fallback for lazy routes
function PageLoader() {
    return (
        <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
    );
}

// Component to handle redirection based on account status
// Component to ensure account exists/is selected
function AccountGuard({ children }: { children: React.ReactNode }) {
    const { accounts, isLoading } = useAccount();

    if (isLoading) return <div>Loading...</div>;

    // If no accounts, force the wizard
    if (accounts.length === 0) {
        return <Navigate to="/wizard" replace />;
    }

    return <>{children}</>;
}

/**
 * MobileRedirect - Redirects mobile devices from desktop routes to mobile routes.
 * 
 * Detects mobile via user-agent and standalone PWA mode.
 * Maps common desktop routes to their /m/* equivalents.
 */
function MobileRedirect({ children }: { children: React.ReactNode }) {
    // Check if running as installed PWA (standalone)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;

    // Check if mobile device
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // Only redirect if in PWA mode, not just mobile browser
    if (!isStandalone) {
        return <>{children}</>;
    }

    // Get current path
    const currentPath = window.location.pathname;

    // Map desktop routes to mobile routes
    const mobileRouteMap: Record<string, string> = {
        '/': '/m/dashboard',
        '/orders': '/m/orders',
        '/inbox': '/m/inbox',
        '/analytics': '/m/analytics',
        '/inventory': '/m/inventory',
        '/settings': '/m/settings',
        '/profile': '/m/profile',
    };

    // Check if viewing a desktop route that has a mobile equivalent
    if (!currentPath.startsWith('/m/') && !currentPath.startsWith('/login') &&
        !currentPath.startsWith('/register') && !currentPath.startsWith('/admin')) {

        // Check for direct route mapping
        if (mobileRouteMap[currentPath]) {
            return <Navigate to={mobileRouteMap[currentPath]} replace />;
        }

        // Handle dynamic routes like /orders/:id -> /m/orders/:id
        if (currentPath.startsWith('/orders/')) {
            return <Navigate to={`/m${currentPath}`} replace />;
        }
        if (currentPath.startsWith('/inbox/')) {
            return <Navigate to={`/m${currentPath}`} replace />;
        }
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
                            <MobileRedirect>
                                <Suspense fallback={<PageLoader />}>
                                    <Routes>
                                        {/* Public Routes */}
                                        <Route path="/login" element={<LoginPage />} />
                                        <Route path="/register" element={<RegisterPage />} />
                                        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                                        <Route path="/data-deletion" element={<DataDeletionPage />} />
                                        <Route path="/terms-of-service" element={<TermsOfServicePage />} />

                                        {/* Protected Routes */}
                                        <Route element={<ProtectedRoute />}>
                                            <Route path="/setup" element={<SetupWizard />} />

                                            {/* Super Admin Routes */}
                                            <Route element={<SuperAdminGuard><AdminLayout><ErrorBoundary><Outlet /></ErrorBoundary></AdminLayout></SuperAdminGuard>}>
                                                <Route path="/admin" element={<AdminDashboard />} />
                                                <Route path="/admin/accounts" element={<AdminAccountsPage />} />
                                                <Route path="/admin/logs" element={<AdminLogsPage />} />
                                                <Route path="/admin/broadcast" element={<AdminBroadcastPage />} />
                                                <Route path="/admin/credentials" element={<AdminCredentialsPage />} />
                                                <Route path="/admin/ai-prompts" element={<AdminAIPromptsPage />} />
                                                <Route path="/admin/settings" element={<AdminSettingsPage />} />
                                            </Route>

                                            <Route element={<DashboardLayout><ErrorBoundary><Outlet /></ErrorBoundary></DashboardLayout>}>
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
                                                <Route path="/ads" element={<AccountGuard><PaidAdsPage /></AccountGuard>} />
                                                <Route path="/marketing/ai" element={<AccountGuard><AdAIPage /></AccountGuard>} />
                                                <Route path="/broadcasts" element={<AccountGuard><BroadcastsPage /></AccountGuard>} />
                                                <Route path="/flows" element={<AccountGuard><FlowsPage /></AccountGuard>} />
                                                <Route path="/inbox" element={<AccountGuard><InboxPage /></AccountGuard>} />
                                                <Route path="/live" element={<AccountGuard><LiveAnalyticsPage /></AccountGuard>} />
                                                <Route path="/analytics" element={<AccountGuard><AnalyticsOverviewPage /></AccountGuard>} />
                                                <Route path="/analytics/revenue" element={<AccountGuard><RevenuePage /></AccountGuard>} />
                                                <Route path="/analytics/attribution" element={<AccountGuard><AttributionPage /></AccountGuard>} />
                                                <Route path="/analytics/cohorts" element={<AccountGuard><CohortsPage /></AccountGuard>} />

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
                                                <Route path="/policies" element={<AccountGuard><PoliciesPage /></AccountGuard>} />
                                            </Route>
                                        </Route>

                                        {/* Mobile PWA Routes */}
                                        <Route element={<ProtectedRoute />}>
                                            <Route element={<MobileLayout><ErrorBoundary><Outlet /></ErrorBoundary></MobileLayout>}>
                                                <Route path="/m/dashboard" element={<AccountGuard><MobileDashboard /></AccountGuard>} />
                                                <Route path="/m/orders" element={<AccountGuard><MobileOrders /></AccountGuard>} />
                                                <Route path="/m/orders/:id" element={<AccountGuard><MobileOrderDetail /></AccountGuard>} />
                                                <Route path="/m/inbox" element={<AccountGuard><MobileInbox /></AccountGuard>} />
                                                <Route path="/m/inbox/:id" element={<AccountGuard><MobileChat /></AccountGuard>} />
                                                <Route path="/m/analytics" element={<AccountGuard><MobileAnalytics /></AccountGuard>} />
                                                <Route path="/m/inventory" element={<AccountGuard><MobileInventory /></AccountGuard>} />
                                                <Route path="/m/more" element={<AccountGuard><MobileMore /></AccountGuard>} />
                                                <Route path="/m/profile" element={<AccountGuard><MobileProfile /></AccountGuard>} />
                                                <Route path="/m/settings" element={<AccountGuard><MobileSettings /></AccountGuard>} />
                                                <Route path="/m/customers" element={<AccountGuard><MobileCustomers /></AccountGuard>} />
                                                <Route path="/m/customers/:id" element={<AccountGuard><MobileCustomerDetail /></AccountGuard>} />
                                                <Route path="/m/notifications" element={<AccountGuard><MobileNotifications /></AccountGuard>} />
                                                <Route path="/m/live-visitors" element={<AccountGuard><MobileLiveVisitors /></AccountGuard>} />
                                                <Route path="/m/visitor/:id" element={<AccountGuard><MobileVisitorDetail /></AccountGuard>} />
                                                <Route path="/m" element={<Navigate to="/m/dashboard" replace />} />
                                            </Route>
                                        </Route>

                                        <Route path="*" element={<Navigate to="/" replace />} />
                                    </Routes>
                                </Suspense>
                            </MobileRedirect>
                        </SyncStatusProvider>
                    </SocketProvider>
                </AccountProvider>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
