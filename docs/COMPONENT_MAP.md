# Component Map

## Core UI Components (`src/components/`)
- **Sidebar**: Main navigation with collapsible groups.
- **AIChat**: Floating assistant widget ("The Oracle").
- **SyncOverlay**: Global loading state for initial data sync.
- **ErrorBoundary**: React error catchment.
- **RoleEditor**: RBAC management UI.

## Analytics Components
- **FilterBuilder**: Complex query builder for filtering reports.
- **DateRangePicker**: Custom date selector.
- **CustomReportBuilder**: Drag-and-drop widget grid.
- **CustomerMap**: Leaflet.js visualization of customer locations.
- **SEOScore**: Gauge chart for product SEO ranking.

## Automation & Canvas
- **FlowNodes**: Custom nodes for ReactFlow.
- **FlowEdges**: Custom connectors for ReactFlow.
- **EmailDesigner/**: Sub-components for the specific email drag-and-drop builder.

## Commerce Specific
- **InvoiceRenderer**: Component that renders the print-ready invoice HTML (used by `html2canvas`).
- **ShipmentTracking**: Timeline view of package status.
