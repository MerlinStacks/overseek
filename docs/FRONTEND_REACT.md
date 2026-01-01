# Frontend Documentation (React + Vite)

## Project Structure
- `src/pages/`: Route components (Views).
- `src/components/`: Reusable UI bricks.
- `src/context/`: Global state (Auth, Sync, Settings).
- `src/db/`: Dexie.js schema and query logic.
- `src/workers/`: Web Workers for background tasks.

## Key Pages

### Commerce
- **DashboardHome** (`/`): Main overview.
- **Orders** (`/orders`): The "Hyper-Grid" order manager. Uses virtual scrolling.
- **Inventory** (`/inventory`): Advanced product/stock management.
- **Customers** (`/customers`): CRM view.

### Analytics
- **Analytics** (`/analytics`): Performance graphs (Recharts).
- **VisitorLog** (`/visitors`): Real-time traffic inspector.
- **Forecasting** (`/analytics/forecasting`): Predictive stock models.

### Tools
- **InvoiceBuilder** (`/invoices/builder`): Drag-and-drop PDF designer.
- **EmailFlowBuilder** (`/automations/new`): ReactFlow-based automation editor.

## Context Providers
1. **AuthProvider**: Manages user session and RBAC permissions.
2. **AccountContext**: Handles multi-tenancy (switching between different WooCommerce stores).
3. **SyncContext**: Communicates with `sync.worker.js`.
4. **PresenceContext**: Socket.io connection for "Who is viewing this?" feature.

## Styling
Tailwind CSS is used for layout, but specialized "Glassmorphism" effects are defined in `index.css`:
- `.glass-panel`: Standard card background.
- `.glass-card`: Interactive card.
- `.btn-primary`: Gradient action buttons.
