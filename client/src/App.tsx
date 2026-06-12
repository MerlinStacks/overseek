
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { AccountProvider, useAccount } from './context/AccountContext';
import { useAccountFeature } from './hooks/useAccountFeature';
import { SocketProvider } from './context/SocketContext';
import { SyncStatusProvider } from './context/SyncStatusContext';
import { ToastProvider } from './context/ToastContext';
import { getRouteTitle, ROUTE_PATHS, ROUTE_PREFIXES, ROUTE_PATTERNS } from './utils/routeTitles';
import { usePushNotifications } from './hooks/usePushNotifications';

import { DashboardLayout } from './components/layout/DashboardLayout';
import { AdminLayout } from './components/layout/AdminLayout';
import { SuperAdminGuard } from './components/layout/SuperAdminGuard';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { LandingPage } from './pages/LandingPage';
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
const AbandonedCartsPage = lazy(() => import('./pages/AbandonedCartsPage').then(m => ({ default: m.AbandonedCartsPage })));
const MarketingPage = lazy(() => import('./pages/MarketingPage').then(m => ({ default: m.MarketingPage })));
const FlowsPage = lazy(() => import('./pages/FlowsPage').then(m => ({ default: m.FlowsPage })));
const TeamPage = lazy(() => import('./pages/TeamPage').then(m => ({ default: m.TeamPage })));
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const SupplyChainPage = lazy(() => import('./pages/SupplyChainPage').then(m => ({ default: m.SupplyChainPage })));
const BOMSyncPage = lazy(() => import('./pages/BOMSyncPage').then(m => ({ default: m.BOMSyncPage })));
const InventoryForecastPage = lazy(() => import('./pages/InventoryForecastPage').then(m => ({ default: m.InventoryForecastPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then(m => ({ default: m.CustomersPage })));
const SegmentsPage = lazy(() => import('./pages/SegmentsPage').then(m => ({ default: m.SegmentsPage })));
const CustomerDetailsPage = lazy(() => import('./pages/CustomerDetailsPage').then(m => ({ default: m.CustomerDetailsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const GoldPriceMarginReportPage = lazy(() => import('./pages/GoldPriceMarginReportPage').then(m => ({ default: m.GoldPriceMarginReportPage })));
const InboxPage = lazy(() => import('./pages/InboxPage').then(m => ({ default: m.InboxPage })));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage').then(m => ({ default: m.ReviewsPage })));
const PaidAdsPage = lazy(() => import('./pages/PaidAdsPage').then(m => ({ default: m.PaidAdsPage })));
const CAPIHealthPage = lazy(() => import('./pages/CAPIHealthPage').then(m => ({ default: m.CAPIHealthPage })));
const SeoPage = lazy(() => import('./pages/SeoPage').then(m => ({ default: m.SeoPage })));
const SeoContentPage = lazy(() => import('./pages/SeoContentPage').then(m => ({ default: m.SeoContentPage })));
const AiManagerPage = lazy(() => import('./pages/AiManagerPage').then(m => ({ default: m.AiManagerPage })));
const BroadcastsPage = lazy(() => import('./pages/BroadcastsPage').then(m => ({ default: m.BroadcastsPage })));
const EmailListsPage = lazy(() => import('./pages/EmailListsPage').then(m => ({ default: m.EmailListsPage })));
const EmailDashboardPage = lazy(() => import('./pages/EmailDashboardPage').then(m => ({ default: m.EmailDashboardPage })));
const EmailSettingsPage = lazy(() => import('./pages/EmailSettingsPage').then(m => ({ default: m.EmailSettingsPage })));
const EmailLogsPage = lazy(() => import('./pages/EmailLogsPage').then(m => ({ default: m.EmailLogsPage })));
const BlockedContactsPage = lazy(() => import('./pages/BlockedContactsPage').then(m => ({ default: m.BlockedContactsPage })));
const HelpCenterHome = lazy(() => import('./pages/HelpCenter/HelpCenterHome').then(m => ({ default: m.HelpCenterHome })));
const HelpArticle = lazy(() => import('./pages/HelpCenter/HelpArticle').then(m => ({ default: m.HelpArticle })));
const LiveAnalyticsPage = lazy(() => import('./pages/LiveAnalyticsPage').then(m => ({ default: m.LiveAnalyticsPage })));
const ProductEditPage = lazy(() => import('./pages/ProductEditPage').then(m => ({ default: m.ProductEditPage })));
const PurchaseOrderEditPage = lazy(() => import('./pages/PurchaseOrderEditPage').then(m => ({ default: m.PurchaseOrderEditPage })));
const InvoiceDesigner = lazy(() => import('./pages/InvoiceDesigner').then(m => ({ default: m.InvoiceDesigner })));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage').then(m => ({ default: m.PoliciesPage })));
const CrawlersPage = lazy(() => import('./pages/CrawlersPage').then(m => ({ default: m.CrawlersPage })));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage').then(m => ({ default: m.UserProfilePage })));
const FeedsPage = lazy(() => import('./pages/FeedsPage').then(m => ({ default: m.FeedsPage })));
const ShippingHubPage = lazy(() => import('./pages/shipping/ShippingHubPage').then(m => ({ default: m.ShippingHubPage })));
const ShippingPackagesPage = lazy(() => import('./pages/shipping/ShippingPackagesPage').then(m => ({ default: m.ShippingPackagesPage })));
const ShippingItemOverwritesPage = lazy(() => import('./pages/shipping/ShippingItemOverwritesPage').then(m => ({ default: m.ShippingItemOverwritesPage })));
const ShippingLabelsPage = lazy(() => import('./pages/shipping/ShippingLabelsPage').then(m => ({ default: m.ShippingLabelsPage })));
const ShippingOperationsPage = lazy(() => import('./pages/shipping/ShippingOperationsPage').then(m => ({ default: m.ShippingOperationsPage })));
const ShippingSettingsPage = lazy(() => import('./pages/shipping/ShippingSettingsPage').then(m => ({ default: m.ShippingSettingsPage })));

// Analytics Sub-Pages
const AnalyticsOverviewPage = lazy(() => import('./pages/analytics/AnalyticsOverviewPage').then(m => ({ default: m.AnalyticsOverviewPage })));
const RevenuePage = lazy(() => import('./pages/analytics/RevenuePage').then(m => ({ default: m.RevenuePage })));
const AttributionPage = lazy(() => import('./pages/analytics/AttributionPage').then(m => ({ default: m.AttributionPage })));
const CLVPage = lazy(() => import('./pages/analytics/CLVPage').then(m => ({ default: m.CLVPage })));

// Admin pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminAccountsPage = lazy(() => import('./pages/admin/AdminAccountsPage').then(m => ({ default: m.AdminAccountsPage })));
const AdminLogsPage = lazy(() => import('./pages/admin/AdminLogsPage').then(m => ({ default: m.AdminLogsPage })));
const AdminBroadcastPage = lazy(() => import('./pages/admin/AdminBroadcastPage').then(m => ({ default: m.AdminBroadcastPage })));
const AdminCredentialsPage = lazy(() => import('./pages/admin/AdminCredentialsPage').then(m => ({ default: m.AdminCredentialsPage })));
const AdminAIPromptsPage = lazy(() => import('./pages/admin/AdminAIPromptsPage').then(m => ({ default: m.AdminAIPromptsPage })));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));
const AdminDiagnosticsPage = lazy(() => import('./pages/admin/AdminDiagnosticsPage').then(m => ({ default: m.AdminDiagnosticsPage })));
const AdminBackupsPage = lazy(() => import('./pages/admin/AdminBackupsPage').then(m => ({ default: m.AdminBackupsPage })));

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
const MobileReviews = lazy(() => import('./pages/mobile/MobileReviews').then(m => ({ default: m.MobileReviews })));
const MobileNotifications = lazy(() => import('./pages/mobile/MobileNotifications').then(m => ({ default: m.MobileNotifications })));
const MobileLiveVisitors = lazy(() => import('./pages/mobile/MobileLiveVisitors').then(m => ({ default: m.MobileLiveVisitors })));
const MobileProfile = lazy(() => import('./pages/mobile/MobileProfile').then(m => ({ default: m.MobileProfile })));
const MobileSettings = lazy(() => import('./pages/mobile/MobileSettings').then(m => ({ default: m.MobileSettings })));
const MobileCustomers = lazy(() => import('./pages/mobile/MobileCustomers').then(m => ({ default: m.MobileCustomers })));
const MobileCustomerDetail = lazy(() => import('./pages/mobile/MobileCustomerDetail').then(m => ({ default: m.MobileCustomerDetail })));
const MobileVisitorDetail = lazy(() => import('./pages/mobile/MobileVisitorDetail').then(m => ({ default: m.MobileVisitorDetail })));
const MobileShareHandler = lazy(() => import('./pages/mobile/MobileShareHandler').then(m => ({ default: m.default })));

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

function FeatureGuard({ featureKey, children }: { featureKey: string; children: React.ReactNode }) {
    const isEnabled = useAccountFeature(featureKey);
    if (!isEnabled) return <Navigate to="/dashboard" replace />;
    return <>{children}</>;
}

/**
 * MobileRedirect - Redirects mobile devices from desktop routes to mobile routes.
 * 
 * Detects mobile via user-agent and standalone PWA mode or Capacitor native context.
 * Maps common desktop routes to their /m/* equivalents.
 */
function MobileRedirect({ children }: { children: React.ReactNode }) {
    // Must be called before any conditional returns (rules of hooks).
    // useLocation() makes this reactive to SW notification click navigations
    // (client.navigate(url)) which window.location.pathname misses.
    const location = useLocation();

    interface StandaloneNavigator extends Navigator {
        standalone?: boolean;
    }
    interface CapacitorBridge {
        isNativePlatform?: () => boolean;
        platform?: string;
    }

    const standaloneNavigator = window.navigator as StandaloneNavigator;
    // Check if running as installed PWA (standalone)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
        standaloneNavigator.standalone === true;

    // Check if running inside Capacitor native app
    const capacitor = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor;
    const isCapacitorNative = capacitor?.isNativePlatform?.() ?? !!capacitor?.platform;

    // Only redirect if in PWA mode or Capacitor native, not just mobile browser
    if (!isStandalone && !isCapacitorNative) {
        return <>{children}</>;
    }

    const currentPath = location.pathname;

    // Map desktop routes to mobile routes
    const mobileRouteMap: Record<string, string> = {
        [ROUTE_PATHS.dashboard]: ROUTE_PATHS.mobileDashboard,
        [ROUTE_PATHS.orders]: ROUTE_PATHS.mobileOrders,
        [ROUTE_PATHS.inbox]: ROUTE_PATHS.mobileInbox,
        [ROUTE_PATHS.analytics]: ROUTE_PATHS.mobileAnalytics,
        [ROUTE_PATHS.inventory]: ROUTE_PATHS.mobileInventory,
        [ROUTE_PATHS.reviews]: ROUTE_PATHS.mobileReviews,
        [ROUTE_PATHS.settings]: ROUTE_PATHS.mobileSettings,
        [ROUTE_PATHS.profile]: ROUTE_PATHS.mobileProfile,
    };

    // Check if viewing a desktop route that has a mobile equivalent
    if (!currentPath.startsWith('/m/') && !currentPath.startsWith('/login') &&
        !currentPath.startsWith('/register') && !currentPath.startsWith('/admin')) {

        // Check for direct route mapping
        if (mobileRouteMap[currentPath]) {
            return <Navigate to={mobileRouteMap[currentPath]} replace />;
        }

        // Handle dynamic routes like /orders/:id -> /m/orders/:id
        if (currentPath.startsWith(ROUTE_PREFIXES.orderDetails)) {
            return <Navigate to={`/m${currentPath}`} replace />;
        }
        if (currentPath.startsWith(ROUTE_PREFIXES.inboxDetail)) {
            return <Navigate to={`/m${currentPath}`} replace />;
        }
    }

    return <>{children}</>;
}

function PageTitleManager() {
    const location = useLocation();
    const { currentAccount } = useAccount();

    useEffect(() => {
        const appName = currentAccount?.appearance?.appName?.trim() || 'OverSeek';
        const pageTitle = getRouteTitle(location.pathname);
        document.title = `${appName} | ${pageTitle}`;
    }, [currentAccount?.appearance?.appName, location.pathname]);

    return null;
}

function PushNotificationBootstrap() {
    usePushNotifications();
    return null;
}

function App() {
    return (
        <ErrorBoundary>
            <BrowserRouter>
            <AuthProvider>
                <AccountProvider>
                    <SocketProvider>
                        <SyncStatusProvider>
                        <ToastProvider>
                            <PageTitleManager />
                            <PushNotificationBootstrap />
                            <MobileRedirect>
                                <Suspense fallback={<PageLoader />}>
                                    <Routes>
                                        {/* Public Routes */}
                                        <Route path={ROUTE_PATHS.home} element={<LandingPage />} />
                                        <Route path={ROUTE_PATHS.login} element={<LoginPage />} />
                                        <Route path={ROUTE_PATHS.register} element={<RegisterPage />} />
                                        <Route path={ROUTE_PATHS.forgotPassword} element={<ForgotPasswordPage />} />
                                        <Route path={ROUTE_PATHS.resetPassword} element={<ResetPasswordPage />} />
                                        <Route path={ROUTE_PATHS.privacyPolicy} element={<PrivacyPolicyPage />} />
                                        <Route path={ROUTE_PATHS.dataDeletion} element={<DataDeletionPage />} />
                                        <Route path={ROUTE_PATHS.termsOfService} element={<TermsOfServicePage />} />
                                        {/* Protected Routes */}
                                        <Route element={<ProtectedRoute />}>
                                            <Route path={ROUTE_PATHS.setup} element={<SetupWizard />} />

                                            {/* Super Admin Routes */}
                                            <Route element={<SuperAdminGuard><AdminLayout><ErrorBoundary><Outlet /></ErrorBoundary></AdminLayout></SuperAdminGuard>}>
                                                <Route path={ROUTE_PATHS.admin} element={<AdminDashboard />} />
                                                <Route path={ROUTE_PATHS.adminAccounts} element={<AdminAccountsPage />} />
                                                <Route path={ROUTE_PATHS.adminLogs} element={<AdminLogsPage />} />
                                                <Route path={ROUTE_PATHS.adminBroadcast} element={<AdminBroadcastPage />} />
                                                <Route path={ROUTE_PATHS.adminCredentials} element={<AdminCredentialsPage />} />
                                                <Route path={ROUTE_PATHS.adminAiPrompts} element={<AdminAIPromptsPage />} />
                                                <Route path={ROUTE_PATHS.adminSettings} element={<AdminSettingsPage />} />
                                                <Route path={ROUTE_PATHS.adminDiagnostics} element={<AdminDiagnosticsPage />} />
                                                <Route path={ROUTE_PATHS.adminBackups} element={<AdminBackupsPage />} />
                                            </Route>

                                            <Route element={<DashboardLayout><ErrorBoundary><Outlet /></ErrorBoundary></DashboardLayout>}>
                                                <Route path={ROUTE_PATHS.dashboard} element={<AccountGuard><DashboardPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.orders} element={<AccountGuard><OrdersPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.orderDetails} element={<AccountGuard><OrderDetailPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.abandonedCarts} element={<AccountGuard><AbandonedCartsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.inventory} element={<AccountGuard><InventoryPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.supplyChain} element={<AccountGuard><SupplyChainPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.inventoryBomSync} element={<AccountGuard><BOMSyncPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.inventoryForecasts} element={<AccountGuard><InventoryForecastPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.productDetails} element={<AccountGuard><ProductEditPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.purchaseOrderNew} element={<AccountGuard><PurchaseOrderEditPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.purchaseOrderEdit} element={<AccountGuard><PurchaseOrderEditPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.customers} element={<AccountGuard><CustomersPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.customerSegments} element={<AccountGuard><SegmentsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.customerDetails} element={<AccountGuard><CustomerDetailsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.marketing} element={<AccountGuard><MarketingPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.ads} element={<AccountGuard><PaidAdsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.capiHealth} element={<AccountGuard><CAPIHealthPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.seo} element={<AccountGuard><SeoPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.seoContent} element={<AccountGuard><SeoContentPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.feeds} element={<AccountGuard><FeatureGuard featureKey="FEED_EXPORTS"><FeedsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path="/shipping" element={<AccountGuard><FeatureGuard featureKey="SHIPPING_HUB"><ShippingHubPage /></FeatureGuard></AccountGuard>} />
                                                <Route path="/shipping/packages" element={<AccountGuard><FeatureGuard featureKey="SHIPPING_HUB"><ShippingPackagesPage /></FeatureGuard></AccountGuard>} />
                                                <Route path="/shipping/item-overwrites" element={<AccountGuard><FeatureGuard featureKey="SHIPPING_HUB"><ShippingItemOverwritesPage /></FeatureGuard></AccountGuard>} />
                                                <Route path="/shipping/labels" element={<AccountGuard><FeatureGuard featureKey="SHIPPING_HUB"><ShippingLabelsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path="/shipping/operations" element={<AccountGuard><FeatureGuard featureKey="SHIPPING_HUB"><ShippingOperationsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path="/shipping/settings" element={<AccountGuard><FeatureGuard featureKey="SHIPPING_HUB"><ShippingSettingsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.aiManager} element={<AccountGuard><FeatureGuard featureKey="AI_MANAGER"><AiManagerPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.broadcasts} element={<AccountGuard><FeatureGuard featureKey="EMAIL"><BroadcastsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.emailLists} element={<AccountGuard><FeatureGuard featureKey="EMAIL"><EmailListsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.emails} element={<AccountGuard><FeatureGuard featureKey="EMAIL"><EmailDashboardPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.emailSettings} element={<AccountGuard><FeatureGuard featureKey="EMAIL"><EmailSettingsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.emailLogs} element={<AccountGuard><FeatureGuard featureKey="EMAIL"><EmailLogsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.blockedContacts} element={<AccountGuard><FeatureGuard featureKey="EMAIL"><BlockedContactsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.flows} element={<AccountGuard><FeatureGuard featureKey="EMAIL"><FlowsPage /></FeatureGuard></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.inbox} element={<AccountGuard><InboxPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.live} element={<AccountGuard><LiveAnalyticsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.analytics} element={<AccountGuard><AnalyticsOverviewPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.analyticsRevenue} element={<AccountGuard><RevenuePage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.analyticsAttribution} element={<AccountGuard><AttributionPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.analyticsCohorts} element={<Navigate to={ROUTE_PATHS.analyticsAttribution} replace />} />
                                                <Route path={ROUTE_PATHS.analyticsClv} element={<AccountGuard><CLVPage /></AccountGuard>} />

                                                <Route path={ROUTE_PATHS.reviews} element={<AccountGuard><ReviewsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.help} element={<AccountGuard><HelpCenterHome /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.helpArticle} element={<AccountGuard><HelpArticle /></AccountGuard>} />

                                                <Route path={ROUTE_PATHS.reports} element={<AccountGuard><ReportsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.reportsGoldPriceMargin} element={<AccountGuard><GoldPriceMarginReportPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.team} element={<AccountGuard><TeamPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.wizard} element={<SetupWizard />} />
                                                <Route path={ROUTE_PATHS.settings} element={<AccountGuard><SettingsPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.profile} element={<AccountGuard><UserProfilePage /></AccountGuard>} />

                                                <Route path={ROUTE_PATHS.invoicesDesign} element={<AccountGuard><InvoiceDesigner /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.invoiceDesignerById} element={<AccountGuard><InvoiceDesigner /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.policies} element={<AccountGuard><PoliciesPage /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.crawlers} element={<AccountGuard><FeatureGuard featureKey="BOT_SHIELD"><CrawlersPage /></FeatureGuard></AccountGuard>} />
                                            </Route>
                                        </Route>

                                        {/* Mobile PWA Routes */}
                                        <Route element={<ProtectedRoute />}>
                                            {/* Full-screen chat route - outside MobileLayout to avoid nav interference */}
                                            <Route path={ROUTE_PATTERNS.mobileChat} element={<AccountGuard><MobileChat /></AccountGuard>} />

                                            <Route element={<MobileLayout><ErrorBoundary><Outlet /></ErrorBoundary></MobileLayout>}>
                                                <Route path={ROUTE_PATHS.mobileDashboard} element={<AccountGuard><MobileDashboard /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileOrders} element={<AccountGuard><MobileOrders /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.mobileOrderDetails} element={<AccountGuard><MobileOrderDetail /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileInbox} element={<AccountGuard><MobileInbox /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.mobileInboxShare} element={<AccountGuard><MobileShareHandler /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileAnalytics} element={<AccountGuard><MobileAnalytics /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileInventory} element={<AccountGuard><MobileInventory /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileReviews} element={<AccountGuard><MobileReviews /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileMore} element={<AccountGuard><MobileMore /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileProfile} element={<AccountGuard><MobileProfile /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileSettings} element={<AccountGuard><MobileSettings /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileCustomers} element={<AccountGuard><MobileCustomers /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.mobileCustomerDetails} element={<AccountGuard><MobileCustomerDetail /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileNotifications} element={<AccountGuard><MobileNotifications /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileLiveVisitors} element={<AccountGuard><MobileLiveVisitors /></AccountGuard>} />
                                                <Route path={ROUTE_PATTERNS.mobileVisitorDetails} element={<AccountGuard><MobileVisitorDetail /></AccountGuard>} />
                                                <Route path={ROUTE_PATHS.mobileRoot} element={<Navigate to={ROUTE_PATHS.mobileDashboard} replace />} />
                                            </Route>
                                        </Route>

                                        <Route path={ROUTE_PATHS.wildcard} element={<Navigate to={ROUTE_PATHS.home} replace />} />
                                    </Routes>
                                </Suspense>
                            </MobileRedirect>

                        </ToastProvider>
                        </SyncStatusProvider>
                    </SocketProvider>
                </AccountProvider>
            </AuthProvider>
        </BrowserRouter>
        </ErrorBoundary>
    );
}

export default App;
