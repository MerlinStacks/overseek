import type {
  OverseekConfig,
  OrderListParams,
  OrderListResponse,
  Order,
  ProductListParams,
  ProductListResponse,
  Product,
  CustomerListParams,
  CustomerListResponse,
  Customer,
  SalesSummary,
  SalesChartParams,
  TopProduct,
  AdsSummary,
  ProductRankingParams,
  InventoryHealthItem,
  InventorySettings,
  PurchaseOrder,
  PurchaseOrderListParams,
  ConversationListParams,
  ConversationListResponse,
  Conversation,
  UnreadCountResponse,
  ReviewListParams,
  ReviewListResponse,
  SearchConsoleParams,
  KeywordRanking,
  SyncStatus,
  DateRangeParams,
} from './types';

export class OverseekClient {
  private baseUrl: string;
  private token: string;
  private accountId: string;

  constructor(config: OverseekConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.accountId = config.accountId;
  }

  // ── HTTP helpers ────────────────────────────

  private async request<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'x-account-id': this.accountId,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OverseekAPIError(res.status, body, path);
    }

    return res.json() as Promise<T>;
  }

  // ── Orders ──────────────────────────────────

  async listOrders(params?: OrderListParams): Promise<OrderListResponse> {
    return this.request<OrderListResponse>('/api/orders', params as Record<string, unknown>);
  }

  async getOrder(id: string): Promise<Order> {
    return this.request<Order>(`/api/orders/${encodeURIComponent(id)}`);
  }

  // ── Products ────────────────────────────────

  async listProducts(params?: ProductListParams): Promise<ProductListResponse> {
    return this.request<ProductListResponse>('/api/products', params as Record<string, unknown>);
  }

  async getProduct(id: string | number): Promise<Product> {
    return this.request<Product>(`/api/products/${encodeURIComponent(id)}`);
  }

  // ── Customers ───────────────────────────────

  async listCustomers(params?: CustomerListParams): Promise<CustomerListResponse> {
    return this.request<CustomerListResponse>('/api/customers', params as Record<string, unknown>);
  }

  async getCustomer(id: string): Promise<Customer> {
    return this.request<Customer>(`/api/customers/${encodeURIComponent(id)}`);
  }

  // ── Analytics ───────────────────────────────

  async getSalesSummary(params?: DateRangeParams): Promise<SalesSummary> {
    return this.request<SalesSummary>('/api/analytics/sales', params as Record<string, unknown>);
  }

  async getSalesChart(params?: SalesChartParams): Promise<unknown> {
    return this.request('/api/analytics/sales-chart', params as Record<string, unknown>);
  }

  async getTopProducts(params?: DateRangeParams): Promise<TopProduct[]> {
    return this.request<TopProduct[]>('/api/analytics/top-products', params as Record<string, unknown>);
  }

  async getRecentOrders(): Promise<Order[]> {
    return this.request<Order[]>('/api/analytics/recent-orders');
  }

  async getAdsSummary(): Promise<AdsSummary> {
    return this.request<AdsSummary>('/api/analytics/ads-summary');
  }

  async getProductRankings(params?: ProductRankingParams): Promise<unknown> {
    return this.request('/api/analytics/products/ranking', params as Record<string, unknown>);
  }

  async getCustomerGrowth(params?: DateRangeParams): Promise<unknown> {
    return this.request('/api/analytics/customer-growth', params as Record<string, unknown>);
  }

  async getSalesForecast(days?: number): Promise<unknown> {
    return this.request('/api/analytics/forecast', days ? { days } : undefined);
  }

  async getAcquisitionChannels(params?: DateRangeParams): Promise<unknown> {
    return this.request('/api/analytics/acquisition/channels', params as Record<string, unknown>);
  }

  async getAnomalies(): Promise<unknown> {
    return this.request('/api/analytics/anomalies');
  }

  // ── Inventory ───────────────────────────────

  async getInventoryHealth(): Promise<InventoryHealthItem[]> {
    return this.request<InventoryHealthItem[]>('/api/inventory/health');
  }

  async getInventorySettings(): Promise<InventorySettings> {
    return this.request<InventorySettings>('/api/inventory/settings');
  }

  async listPurchaseOrders(params?: PurchaseOrderListParams): Promise<PurchaseOrder[]> {
    return this.request<PurchaseOrder[]>('/api/inventory/purchase-orders', params as Record<string, unknown>);
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder> {
    return this.request<PurchaseOrder>(`/api/inventory/purchase-orders/${encodeURIComponent(id)}`);
  }

  // ── Conversations / Inbox ───────────────────

  async listConversations(params?: ConversationListParams): Promise<ConversationListResponse> {
    return this.request<ConversationListResponse>('/api/chat/conversations', params as Record<string, unknown>);
  }

  async getConversation(id: string): Promise<Conversation> {
    return this.request<Conversation>(`/api/chat/${encodeURIComponent(id)}`);
  }

  async getUnreadCount(): Promise<UnreadCountResponse> {
    return this.request<UnreadCountResponse>('/api/chat/unread-count');
  }

  // ── Reviews ─────────────────────────────────

  async listReviews(params?: ReviewListParams): Promise<ReviewListResponse> {
    return this.request<ReviewListResponse>('/api/reviews', params as Record<string, unknown>);
  }

  // ── Search Console ──────────────────────────

  async getKeywordRankings(params?: SearchConsoleParams): Promise<KeywordRanking[]> {
    return this.request<KeywordRanking[]>('/api/search-console/keywords', params as Record<string, unknown>);
  }

  // ── Sync Status ─────────────────────────────

  async getSyncStatus(): Promise<SyncStatus> {
    return this.request<SyncStatus>('/api/sync/status');
  }
}

// ── Error class ───────────────────────────────

export class OverseekAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`OverSeek API error ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = 'OverseekAPIError';
  }
}
