// ──────────────────────────────────────────────
// Shared types for OverSeek MCP + CLI
// ──────────────────────────────────────────────

/** Client configuration */
export interface OverseekConfig {
  /** Base URL of the OverSeek API (e.g. https://app.example.com) */
  baseUrl: string;
  /** JWT bearer token */
  token: string;
  /** Account ID to scope all queries to */
  accountId: string;
}

// ── Pagination ─────────────────────────────────

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface CursorPaginationParams {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CursorPaginatedResponse<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

// ── Date range filter ──────────────────────────

export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}

// ── Orders ─────────────────────────────────────

export interface Order {
  id: string;
  wooId: number;
  number: string;
  status: string;
  total: number;
  currency: string;
  dateCreated: string;
  billing?: Record<string, unknown>;
  shipping?: Record<string, unknown>;
  lineItems?: Record<string, unknown>[];
  tracking_number?: string | null;
  tracking_url?: string | null;
  tags?: string[];
}

export interface OrderListParams {
  limit?: number;
  status?: string;
  customerId?: string;
  billingEmail?: string;
}

export interface OrderListResponse {
  orders: Order[];
}

// ── Products ───────────────────────────────────

export interface Product {
  id: string;
  wooId: number;
  name: string;
  sku: string;
  status: string;
  price: number;
  regularPrice?: number;
  salePrice?: number;
  stockQuantity: number | null;
  stockStatus: string;
  type: string;
  categories?: string[];
}

export interface ProductListParams extends PaginationParams {
  q?: string;
}

export interface ProductListResponse {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Customers ──────────────────────────────────

export interface Customer {
  id: string;
  wooId: number;
  firstName: string;
  lastName: string;
  email: string;
  ordersCount?: number;
  totalSpent?: number;
  dateCreated?: string;
}

export interface CustomerListParams extends PaginationParams {
  q?: string;
}

export interface CustomerListResponse {
  customers: Customer[];
  total: number;
  page: number;
  limit: number;
}

// ── Analytics ──────────────────────────────────

export interface SalesSummary {
  total: number;
  count: number;
  currency: string;
}

export interface SalesChartParams extends DateRangeParams {
  interval?: 'daily' | 'weekly' | 'monthly';
}

export interface TopProduct {
  productId: number;
  name: string;
  quantity: number;
  total: number;
}

export interface AdsSummary {
  spend: number;
  roas: number;
  clicks: number;
  impressions: number;
  currency: string;
}

export interface ProductRankingParams {
  period?: '7d' | '30d' | '90d' | 'ytd';
  sortBy?: 'revenue' | 'units' | 'orders' | 'margin';
  limit?: number;
}

// ── Inventory ──────────────────────────────────

export interface InventoryHealthItem {
  productId: string;
  productName: string;
  sku: string;
  stockQuantity: number;
  riskLevel: string;
  daysOfStock?: number;
}

export interface InventorySettings {
  accountId?: string;
  isEnabled?: boolean;
  lowStockThresholdDays?: number;
  alertEmails?: string[];
}

export interface PurchaseOrder {
  id: string;
  status: string;
  supplierId?: string;
  supplierName?: string;
  totalCost?: number;
  createdAt?: string;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  productName?: string;
  sku?: string;
  quantity: number;
  unitCost?: number;
}

export interface PurchaseOrderListParams {
  status?: string;
}

// ── Conversations / Inbox ──────────────────────

export interface Conversation {
  id: string;
  status: string;
  channel: string;
  customerName?: string;
  customerEmail?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  assignee?: string;
  unreadCount?: number;
}

export interface ConversationListParams extends CursorPaginationParams {
  status?: string;
  assignedTo?: string;
}

export interface ConversationListResponse {
  conversations: Conversation[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface UnreadCountResponse {
  count: number;
}

// ── Reviews ────────────────────────────────────

export interface Review {
  id: string;
  wooId?: number;
  productName?: string;
  reviewer: string;
  reviewerEmail?: string;
  rating: number;
  review: string;
  status: string;
  dateCreated?: string;
}

export interface ReviewListParams extends PaginationParams {
  status?: string;
  search?: string;
}

export interface ReviewListResponse {
  reviews: Review[];
  total: number;
  page: number;
  limit: number;
}

// ── Search Console ─────────────────────────────

export interface KeywordRanking {
  keyword: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
  url?: string;
}

export interface SearchConsoleParams extends DateRangeParams {
  limit?: number;
}

// ── Sync Status ────────────────────────────────

export interface SyncStatus {
  lastSync?: string;
  status: string;
  productsCount?: number;
  ordersCount?: number;
  customersCount?: number;
}
