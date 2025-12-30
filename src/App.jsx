import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SettingsPage from './pages/Settings';
import AdminLayout from './layouts/AdminLayout'; // Keep Layouts sync for perceived perf
import DashboardLayout from './layouts/DashboardLayout';
import DashboardHome from './pages/DashboardHome';
import LoginPage from './pages/Login';

// Lazy Load Heavy Pages
const CreateProductPage = React.lazy(() => import('./pages/CreateProduct'));
const InventoryPage = React.lazy(() => import('./pages/Inventory'));
const SuppliersPage = React.lazy(() => import('./pages/Suppliers'));
const AdminDashboard = React.lazy(() => import('./pages/Admin/Dashboard'));
const AdminAccountsPage = React.lazy(() => import('./pages/Admin/Accounts'));
const AdminToolsPage = React.lazy(() => import('./pages/Admin/Tools'));
const AdminLogsPage = React.lazy(() => import('./pages/Admin/Logs'));
const PurchaseOrdersPage = React.lazy(() => import('./pages/PurchaseOrders'));
const ProductsPage = React.lazy(() => import('./pages/Products'));
const ProductDetailsPage = React.lazy(() => import('./pages/ProductDetails'));
const OrdersPage = React.lazy(() => import('./pages/Orders'));
const OrderDetailsPage = React.lazy(() => import('./pages/OrderDetails'));
const CustomersPage = React.lazy(() => import('./pages/Customers'));
const CustomerDetailsPage = React.lazy(() => import('./pages/CustomerDetails'));
const CartsPage = React.lazy(() => import('./pages/Carts'));
const AutomationsPage = React.lazy(() => import('./pages/Automations'));
const EmailFlowBuilder = React.lazy(() => import('./pages/EmailFlowBuilder'));
const VisitorLogPage = React.lazy(() => import('./pages/VisitorLog'));
const AnalyticsPage = React.lazy(() => import('./pages/Analytics'));
const ForecastingPage = React.lazy(() => import('./pages/Forecasting'));
const ReportsPage = React.lazy(() => import('./pages/Reports'));
const ProductReportsPage = React.lazy(() => import('./pages/ProductReports'));
const BehaviourPage = React.lazy(() => import('./pages/Behaviour'));
const CreateOrderPage = React.lazy(() => import('./pages/CreateOrder'));
const CouponsPage = React.lazy(() => import('./pages/Coupons'));
const UsersPage = React.lazy(() => import('./pages/Users'));
const InvoiceBuilder = React.lazy(() => import('./pages/InvoiceBuilder'));
const ReviewsPage = React.lazy(() => import('./pages/Reviews'));
const InboxPage = React.lazy(() => import('./pages/Inbox'));
const HelpPage = React.lazy(() => import('./pages/Help'));

import AIChat from './components/AIChat';
import ErrorBoundary from './components/ErrorBoundary';

// Loading Component
const PageLoader = () => (
  <div style={{
    height: '100%',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)'
  }}>
    <div className="spinner" style={{ marginRight: '10px' }}></div> Loading...
  </div>
);

import { AuthProvider, useAuth } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import SyncOverlay from './components/SyncOverlay';
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>Loading...</div>;
  if (!isAuthenticated) return <LoginPage />;
  return children;
};

import { PresenceProvider } from './context/PresenceContext';
import { SettingsProvider } from './context/SettingsContext';

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SyncProvider>
          <SettingsProvider>
            <Router>
              <PresenceProvider>
                <React.Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route element={
                      <ProtectedRoute>
                        <DashboardLayout />
                      </ProtectedRoute>
                    }>
                      <Route path="/" element={<DashboardHome />} />
                      <Route path="/orders" element={<OrdersPage />} />
                      <Route path="/orders/new" element={<CreateOrderPage />} />
                      <Route path="/orders/:id" element={<OrderDetailsPage />} />
                      <Route path="/products" element={<ProductsPage />} />
                      <Route path="/inventory" element={<InventoryPage />} />
                      <Route path="/suppliers" element={<SuppliersPage />} />
                      <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
                      <Route path="/products/new" element={<CreateProductPage />} />
                      <Route path="/products/:id" element={<ProductDetailsPage />} />
                      <Route path="/customers" element={<CustomersPage />} />
                      <Route path="/customers/:id" element={<CustomerDetailsPage />} />
                      <Route path="/carts" element={<CartsPage />} />
                      <Route path="/automations" element={<AutomationsPage />} />
                      <Route path="/automations/new" element={<EmailFlowBuilder />} />
                      <Route path="/automations/:id" element={<EmailFlowBuilder />} />
                      <Route path="/visitors" element={<VisitorLogPage />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/coupons" element={<CouponsPage />} />
                      <Route path="/analytics" element={<AnalyticsPage />} />
                      <Route path="/analytics/reports" element={<ReportsPage />} />
                      <Route path="/analytics/products" element={<ProductReportsPage />} />
                      <Route path="/analytics/behaviour" element={<BehaviourPage />} />
                      <Route path="/analytics/forecasting" element={<ForecastingPage />} />
                      <Route path="/reviews" element={<ReviewsPage />} />
                      <Route path="/inbox" element={<InboxPage />} />
                      <Route path="/invoices/builder" element={<InvoiceBuilder />} />
                      <Route path="/help" element={<HelpPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Route>

                    {/* Admin Routes */}
                    <Route path="/admin" element={
                      <ProtectedRoute>
                        <AdminLayout />
                      </ProtectedRoute>
                    }>
                      <Route index element={<AdminDashboard />} />
                      <Route path="accounts" element={<AdminAccountsPage />} />
                      <Route path="logs" element={<AdminLogsPage />} />
                      <Route path="tools" element={<AdminToolsPage />} />
                    </Route>
                  </Routes>
                </React.Suspense>
                <AIChat />
                <SyncOverlay />
              </PresenceProvider>
            </Router>
          </SettingsProvider>
        </SyncProvider>
      </AuthProvider>
    </ErrorBoundary >
  );
}

export default App;
