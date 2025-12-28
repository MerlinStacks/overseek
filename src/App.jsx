import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardHome from './pages/DashboardHome';

// Placeholders for other routes
const Placeholder = ({ title }) => (
  <div style={{ padding: '2rem' }}>
    <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{title}</h1>
  </div>
);

import SettingsPage from './pages/Settings';
import CreateProductPage from './pages/CreateProduct';
import InventoryPage from './pages/Inventory';
import SuppliersPage from './pages/Suppliers';
import AdminLayout from './layouts/AdminLayout';
import AdminDashboard from './pages/Admin/Dashboard';
import AdminAccountsPage from './pages/Admin/Accounts';
import AdminToolsPage from './pages/Admin/Tools';
import AdminLogsPage from './pages/Admin/Logs';
import PurchaseOrdersPage from './pages/PurchaseOrders';
import ProductsPage from './pages/Products';
import ProductDetailsPage from './pages/ProductDetails';
import OrdersPage from './pages/Orders';
import OrderDetailsPage from './pages/OrderDetails';
import CustomersPage from './pages/Customers';
import CustomerDetailsPage from './pages/CustomerDetails';
import CartsPage from './pages/Carts';
import AutomationsPage from './pages/Automations';
import EmailFlowBuilder from './pages/EmailFlowBuilder';
import VisitorLogPage from './pages/VisitorLog';
import AnalyticsPage from './pages/Analytics';
import ForecastingPage from './pages/Forecasting';
import ReportsPage from './pages/Reports';
import ProductReportsPage from './pages/ProductReports';
import BehaviourPage from './pages/Behaviour';

import CreateOrderPage from './pages/CreateOrder';
import CouponsPage from './pages/Coupons';
import UsersPage from './pages/Users';
import InvoiceBuilder from './pages/InvoiceBuilder';
import ReviewsPage from './pages/Reviews';
import InboxPage from './pages/Inbox';
import HelpPage from './pages/Help';
import AIChat from './components/AIChat';
import ErrorBoundary from './components/ErrorBoundary';

import { AuthProvider, useAuth } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import SyncOverlay from './components/SyncOverlay';
import LoginPage from './pages/Login';

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
