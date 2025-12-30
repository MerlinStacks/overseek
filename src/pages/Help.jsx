import React, { useState, useMemo } from 'react';
import {
    Book, MessageCircle, ShoppingBag, BarChart2, Shield,
    Search, ChevronRight, Zap, Package, MapPin, Edit2,
    HelpCircle, Code, Layers, ChevronDown, Database, Lock, Globe,
    ThumbsUp, ThumbsDown, Mail, ExternalLink, Menu, X
} from 'lucide-react';
import './Help.css';

const Help = () => {
    // Navigation State
    const [expandedCategories, setExpandedCategories] = useState(['getting-started', 'sales']);
    const [activeArticle, setActiveArticle] = useState('welcome');
    const [searchTerm, setSearchTerm] = useState('');
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const toggleCategory = (catId) => {
        setExpandedCategories(prev =>
            prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
        );
    };

    // --- Content Database ---
    const helpData = [
        {
            id: 'getting-started',
            label: 'Getting Started',
            icon: <Book size={18} />,
            articles: [
                {
                    id: 'welcome',
                    title: 'Welcome to WooDash',
                    content: (
                        <div>
                            <p className="help-lead">WooDash is a high-performance, local-first dashboard designed to make managing your WooCommerce store instant and offline-capable.</p>
                            <div className="help-alert info">
                                <strong>Core Philosophy:</strong> We bring the database to <em>you</em>. By syncing your store data to IndexDB (Local Database), we achieve 0ms latency for searches and filtering.
                            </div>
                            <h3>Why is it so fast?</h3>
                            <p>Traditional dashboards wait for the server on every click. WooDash inverts this model:</p>
                            <ul className="help-list">
                                <li><strong>Zero Latency:</strong> Search 10,000 orders instantly without server round-trips.</li>
                                <li><strong>Offline Capable:</strong> View data, queue edits, and draft content without an internet connection.</li>
                                <li><strong>Optimistic UI:</strong> Actions happen instantly on screen, then sync to the server in the background.</li>
                            </ul>
                            <h3>What can I do here?</h3>
                            <p>Everything you do in WooCommerce, but faster:</p>
                            <ul>
                                <li>Manage Orders & Fulfillment</li>
                                <li>Track Live Visitors & Carts</li>
                                <li>Create Automations & Email Flows</li>
                                <li>Analyze Sales & Forecast Revenue</li>
                            </ul>
                        </div>
                    )
                },
                {
                    id: 'connecting-store',
                    title: 'Connecting Your Store',
                    content: (
                        <div>
                            <p>To use WooDash, you need to connect your WooCommerce store securely using REST API keys.</p>
                            <h3>Step-by-Step Guide</h3>
                            <div className="help-alert warning">
                                <strong>Prerequisite:</strong> You need full Admin access to your WordPress / WooCommerce store to generate keys.
                            </div>
                            <ol>
                                <li>Go to <strong>Settings &gt; General</strong> in WooDash.</li>
                                <li>Enter your <strong>Store URL</strong> (e.g., <code>https://mystore.com</code>). ensure you include <code>https://</code>.</li>
                                <li>In your WordPress Admin, go to <strong>WooCommerce &gt; Settings &gt; Advanced &gt; REST API</strong>.</li>
                                <li>Click <strong>Add Key</strong>. Give it a description (e.g., "WooDash App").</li>
                                <li>Set Permissions to <strong>Read/Write</strong>. This is critical for updating orders and inventory.</li>
                                <li>Click <strong>Generate API Key</strong>.</li>
                                <li>Copy the <strong>Consumer Key</strong> and <strong>Consumer Secret</strong> into the dashboard settings.</li>
                            </ol>
                            <h3>Troubleshooting Connection</h3>
                            <p>If you see a "Network Error" or "401 Unauthorized":</p>
                            <ul>
                                <li><strong>Check HTTPS:</strong> Your store must have a valid SSL certificate.</li>
                                <li><strong>Auth Method:</strong> Some hosting providers (like GoDaddy or Bluehost) block the default Basic Auth header. Try changing the <strong>Auth Method</strong> to "Query String" in WooDash Settings.</li>
                                <li><strong>Firewall:</strong> Ensure no security plugins (Wordfence, iThemes) are blocking the REST API. Whitelist your IP if necessary.</li>
                            </ul>
                        </div>
                    )
                },
                {
                    id: 'requirements',
                    title: 'System Requirements',
                    content: (
                        <div>
                            <p>WooDash runs entirely in your browser using modern web technologies like IndexDB and Web Workers. Your device performance directly impacts the app speed.</p>
                            <table className="help-table">
                                <thead>
                                    <tr>
                                        <th>Component</th>
                                        <th>Requirement</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td><strong>Browser</strong></td>
                                        <td>Chrome 90+, Edge 90+, Safari 15+, Firefox 90+</td>
                                    </tr>
                                    <tr>
                                        <td><strong>RAM</strong></td>
                                        <td>8GB+ Recommended (especially for stores with &gt;5,000 products)</td>
                                    </tr>
                                    <tr>
                                        <td><strong>Storage</strong></td>
                                        <td>~500MB available disk space for local caching (IndexDB)</td>
                                    </tr>
                                    <tr>
                                        <td><strong>Processor</strong></td>
                                        <td>Modern Multi-core CPU (M1/M2/M3, Intel i5 10th gen+, AMD Ryzen 5000+)</td>
                                    </tr>
                                </tbody>
                            </table>
                            <div className="help-alert info">
                                <strong>Large Catalogs:</strong> For stores with over 50,000 orders, the initial sync may take several minutes. Subsequent syncs will be incremental and much faster.
                            </div>
                        </div>
                    )
                }
            ]
        },
        {
            id: 'architecture',
            label: 'Architecture & Internals',
            icon: <Layers size={18} />,
            class: 'advanced',
            articles: [
                {
                    id: 'sync-engine',
                    title: 'The Sync Engine',
                    content: (
                        <div>
                            <p>The synchronization engine is the heart of WooDash. It handles the complexity of bridging a remote REST API with a local database.</p>
                            <h3>1. Concurrent Batching</h3>
                            <p>To maximize speed without freezing the browser UI, we use a controlled parallelism strategy:</p>
                            <div className="code-block">
                                {`// Performance Strategy
const WORKER_THREADS = 2;
const BATCH_SIZE = 50; // Items per batch

// We process multiple API pages in parallel
await Promise.all([
  fetchPage(1),
  fetchPage(2),
  fetchPage(3)
]);`}
                            </div>
                            <p>We fetch multiple pages at once, process the raw JSON, and then write to IndexDB in large "Transactions". This prevents database locking and UI jank.</p>

                            <h3>2. Data Enrichment</h3>
                            <p>Raw API data is transformed before storage to make it easier to query:</p>
                            <ul>
                                <li><strong>Flattening:</strong> Nested <code>meta_data</code> (like Cost of Goods, Tracking Numbers) is extracted to top-level fields for sorting.</li>
                                <li><strong>Guest Extraction:</strong> We scan Order history to create "Virtual Customer" profiles for guest checkouts, linking them by email address.</li>
                            </ul>
                        </div>
                    )
                },
                {
                    id: 'local-first',
                    title: 'Local-First Strategy',
                    content: (
                        <div>
                            <h3>Why Local-First?</h3>
                            <p>Most SaaS dashboards are "Cloud-First", meaning every click waits for a server response. If your internet lags, your work stops. WooDash is "Local-First".</p>
                            <ul>
                                <li><strong>Reads:</strong> 100% Local. Filtering 10,000 orders takes milliseconds because the data is already in RAM/Disk.</li>
                                <li><strong>Writes:</strong> Optimistic. When you update an order status, the UI updates <em>immediately</em>. We then queue a background task to tell WooCommerce. If the network fails, we retry automatically.</li>
                            </ul>
                            <h3>Compound Primary Keys</h3>
                            <p>To support Multi-tenancy (Multiple Stores) in a single database, our schema uses compound keys:</p>
                            <div className="code-block">
                                <code>PK = [account_id, id]</code>
                            </div>
                            <p>This ensures Order #105 from Store A doesn't overwrite Order #105 from Store B, while keeping queries fast.</p>
                        </div>
                    )
                },
                {
                    id: 'security-privacy',
                    title: 'Security & Privacy',
                    content: (
                        <div>
                            <p>Security is a primary design constraint of WooDash. We operate on a "Zero-Knowledge" principle regarding your store data.</p>
                            <div className="help-alert success">
                                <strong>Direct Connection:</strong> Your data flows directly from <em>Your Store</em> &rarr; <em>Your Browser</em>. We (the app developers) do not proxy, store, or see your customer data. There is no "Middleman Server".
                            </div>
                            <h3>Encryption</h3>
                            <p>API Keys are stored in your browser's <code>localStorage</code>. While secure for personal devices, we recommend:</p>
                            <ul>
                                <li>Locking your workstation when away.</li>
                                <li>Using the "Logout" feature (which clears keys) if on a shared computer.</li>
                            </ul>
                            <h3>Sandbox</h3>
                            <p>The code runs in a sandboxed browser environment. It cannot access your file system (beyond the approved storage quotas) or other browser tabs.</p>
                        </div>
                    )
                }
            ]
        },
        {
            id: 'sales',
            label: 'Sales & Orders',
            icon: <ShoppingBag size={18} />,
            articles: [
                {
                    id: 'managing-orders',
                    title: 'Managing Orders',
                    content: (
                        <div>
                            <p>The Orders page is your command center for fulfillment. It aggregates orders from all your connected channels.</p>
                            <h3>Key Functionality</h3>
                            <ul>
                                <li><strong>Status Change:</strong> Click any status badge to reveal a quick-change dropdown. Cycles through Pending &rarr; Processing &rarr; Completed.</li>
                                <li><strong>Bulk Actions:</strong> Select multiple orders (Shift+Click) to change statuses or print invoices in batch.</li>
                                <li><strong>Private Notes:</strong> Add internal notes (e.g., "Fraud check passed") that sync to WooCommerce but are only visible to staff.</li>
                            </ul>
                            <h3>Auto-Tagging</h3>
                            <p>You can configure rules to automatically tag incoming orders based on the products they contain. Go to <strong>Settings</strong> to enable.</p>
                        </div>
                    )
                },
                {
                    id: 'live-carts',
                    title: 'Live Cart Monitoring',
                    content: (
                        <div>
                            <p>See exactly what customers are adding to their cart in real-time. This reveals "High Intent" traffic that standard analytics misses.</p>
                            <div className="help-alert info">
                                <strong>How it works:</strong> A lightweight script on your storefront broadcasts "Add to Cart" events via WebSockets to your dashboard. Latency is typically under 2 seconds.
                            </div>
                            <p><strong>Privacy Note:</strong> Cart data is ephemeral. It is cleared automatically after 2 hours of inactivity to respect user privacy.</p>
                        </div>
                    )
                },
                {
                    id: 'invoice-builder',
                    title: 'Invoice Builder',
                    content: (
                        <div>
                            <p>The Invoice Builder allows you to design professional PDF invoices that reflect your brand.</p>
                            <h3>Features</h3>
                            <ul>
                                <li><strong>Drag & Drop:</strong> Arrange header, customer info, line items, and footer blocks visually.</li>
                                <li><strong>Variables:</strong> Use dynamic placeholders like <code>{`{customer_name}`}</code> or <code>{`{order_total}`}</code>.</li>
                                <li><strong>Client-Side Generation:</strong> PDFs are generated entirely in your browser using <code>jspdf</code>. No customer data is sent to a third-party server for generation.</li>
                            </ul>
                        </div>
                    )
                }
            ]
        },
        {
            id: 'inventory',
            label: 'Inventory & Purchasing',
            icon: <Package size={18} />,
            articles: [
                {
                    id: 'recipes',
                    title: 'Recipes (Virtual Bundles)',
                    content: (
                        <div>
                            <p>WooDash allows you to create "Virtual Bundles" or "Recipes" logic without needing heavy WooCommerce plugins.</p>
                            <h3>Example Scenario</h3>
                            <p>You sell a <strong>Gift Box</strong> that contains:</p>
                            <ul>
                                <li>1x [SKU-101] Shampoo</li>
                                <li>2x [SKU-102] Soap Bar</li>
                            </ul>
                            <p><strong>The Problem:</strong> WooCommerce doesn't natively know that selling a Gift Box should reduce the stock of Shampoo and Soap.</p>
                            <p><strong> The Solution:</strong> Define a Recipe in WooDash. We automatically calculate the "Potential Stock" of the Gift Box based on the lowest common denominator of its ingredients. If you sell a Soap Bar separately, the Gift Box stock updates instantly.</p>
                        </div>
                    )
                },
                {
                    id: 'purchase-orders',
                    title: 'Purchase Orders (POs)',
                    content: (
                        <div>
                            <p>Track incoming stock from Suppliers and predict when you need to reorder.</p>
                            <table className="help-table">
                                <thead>
                                    <tr>
                                        <th>Status</th>
                                        <th>Meaning</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td><strong>Draft</strong></td>
                                        <td>Planning phase. Items are tentative. No effect on stats.</td>
                                    </tr>
                                    <tr>
                                        <td><strong>Ordered</strong></td>
                                        <td>Confirmed with Supplier. Adds to "Incoming Stock" count.</td>
                                    </tr>
                                    <tr>
                                        <td><strong>Received</strong></td>
                                        <td>Stock has arrived. Clicking "Receive" will update actual WooCommerce stock quantities.</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )
                }
            ]
        },
        {
            id: 'crm',
            label: 'CRM & Inbox',
            icon: <MessageCircle size={18} />,
            articles: [
                {
                    id: 'magic-map',
                    title: 'MagicMap & Tracker',
                    content: (
                        <div>
                            <p>Provide "Telepathic Support". When chatting with a customer, the <strong>MagicMap</strong> panel shows their context:</p>
                            <ul>
                                <li><strong>Location:</strong> City/Country inferred from IP address.</li>
                                <li><strong>Current Page:</strong> The exact URL they are browsing right now.</li>
                                <li><strong>Device:</strong> Mobile/Desktop/Tablet.</li>
                            </ul>
                            <p>This allows you to say <em>"I see you're looking at the Blue Shirt, let me check stock for that..."</em> without asking them.</p>
                        </div>
                    )
                },
                {
                    id: 'segments',
                    title: 'Customer Segments',
                    content: (
                        <div>
                            <p>Create dynamic groups of customers based on behavior.</p>
                            <ul>
                                <li><strong>VIPs:</strong> Total Spent &gt; $500</li>
                                <li><strong>Whales:</strong> Avg Order Value &gt; $200</li>
                                <li><strong>At Risk:</strong> Last Order &gt; 90 Days ago</li>
                            </ul>
                            <p>These segments sync to the Automation engine, allowing you to trigger flows when a customer enters or leaves a segment.</p>
                        </div>
                    )
                }
            ]
        },
        {
            id: 'marketing',
            label: 'Marketing & Automations',
            icon: <Zap size={18} />,
            articles: [
                {
                    id: 'automation-builder',
                    title: 'Visual Flow Builder',
                    content: (
                        <div>
                            <p>Automate your marketing with a node-based visual editor.</p>
                            <h3>Node Types</h3>
                            <ul>
                                <li><strong>Triggers:</strong> Order Created, Cart Abandoned, Review Posted, Segment Entered.</li>
                                <li><strong>Logic:</strong> Delays (Time), Conditionals (If/Else), Splits (A/B Test).</li>
                                <li><strong>Actions:</strong> Send Email, Add Tag, HTTP Webhook, Create Coupon.</li>
                            </ul>
                        </div>
                    )
                },
                {
                    id: 'coupons',
                    title: 'Coupons Management',
                    content: (
                        <div>
                            <p>Create and manage dynamic coupons. Track usage stats and set complex expiry rules.</p>
                            <p>Coupons created here sync directly to WooCommerce native coupons, but with enhanced tracking features.</p>
                        </div>
                    )
                }
            ]
        },
        {
            id: 'analytics',
            label: 'Analytics & Reports',
            icon: <BarChart2 size={18} />,
            articles: [
                {
                    id: 'forecasting',
                    title: 'Forecasting Logic',
                    content: (
                        <div>
                            <p>The dashboard projects future revenue using statistical analysis on your historical data.</p>
                            <h3>Methodology</h3>
                            <p>We use <strong>Linear Regression</strong> on your last 90 days of sales data to calculate a <code>trend_slope</code>. We then account for day-of-week seasonality (e.g., weekends are typically slower).</p>
                            <div className="help-alert info">
                                <strong>Accuracy:</strong> Forecasting works best with consistent sales volume. Flash sales or viral events may skew the short-term prediction.
                            </div>
                        </div>
                    )
                },
                {
                    id: 'visitor-log',
                    title: 'Visitor Log',
                    content: (
                        <div>
                            <p>Track real-time traffic to your site.</p>
                            <ul>
                                <li><strong>Human vs Bot:</strong> We use heuristic analysis to filter out search engine crawlers.</li>
                                <li><strong>Source Attribution:</strong> See if visitors came from Google, Facebook, or Direct traffic.</li>
                                <li><strong>Session Journey:</strong> View the full path a visitor took before purchasing.</li>
                            </ul>
                        </div>
                    )
                }
            ]
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: <Shield size={18} />,
            articles: [
                {
                    id: 'ai-settings',
                    title: 'AI Intelligence',
                    content: (
                        <div>
                            <p>Enable AI features by configuring an OpenRouter API key.</p>
                            <h3>Capabilities</h3>
                            <ul>
                                <li><strong>Smart Replies:</strong> AI suggests replies to customer inquiries based on order history.</li>
                                <li><strong>Report Analysis:</strong> Ask questions like "Why did sales drop yesterday?" and get data-backed answers.</li>
                            </ul>
                            <div className="help-alert warning">
                                <strong>Cost:</strong> AI usage is billed by your API provider (OpenRouter). We do not charge detailed markup.
                            </div>
                        </div>
                    )
                }
            ]
        }
    ];

    // --- Derived State for View ---
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const allArticles = useMemo(() => helpData.flatMap(cat => cat.articles.map(art => ({ ...art, categoryId: cat.id, categoryLabel: cat.label }))), []);

    const currentArticle = useMemo(() => {
        return allArticles.find(a => a.id === activeArticle);
    }, [activeArticle, allArticles]);

    const searchResults = useMemo(() => {
        if (!searchTerm) return [];
        return allArticles.filter(a => {
            // Simple text extraction for object content would be needed for perfect search, 
            // but for now we match title and assuming content is indexable or simplistic.
            return a.title.toLowerCase().includes(searchTerm.toLowerCase());
        });
    }, [searchTerm, allArticles]);

    return (
        <div className="page-container help-page-container">
            {/* Mobile Header */}
            <div className="mobile-header" style={{ display: 'none' }}>
                <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                    {mobileMenuOpen ? <X /> : <Menu />}
                </button>
                <span>Help Center</span>
            </div>

            {/* Sidebar */}
            <div className={`help-sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
                <div className="help-search-area">
                    <Search size={16} style={{ position: 'absolute', left: 36, top: 36, color: 'var(--text-muted)' }} />
                    <input
                        type="text"
                        className="input-field"
                        placeholder="Search documentation..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ paddingLeft: 40, width: '100%', background: 'rgba(0,0,0,0.2)' }}
                    />
                </div>

                <div className="help-nav">
                    {searchTerm ? (
                        <div>
                            <div style={{ padding: '0 12px 8px', fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
                                Search Results
                            </div>
                            {searchResults.length > 0 ? (
                                searchResults.map(article => (
                                    <div
                                        key={article.id}
                                        className={`nav-article-link ${activeArticle === article.id ? 'active' : ''}`}
                                        style={{ paddingLeft: 12 }}
                                        onClick={() => {
                                            setActiveArticle(article.id);
                                            setSearchTerm(''); // Optional: clear search on select
                                            setMobileMenuOpen(false);
                                        }}
                                    >
                                        <div style={{ fontWeight: 500 }}>{article.title}</div>
                                        <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{article.categoryLabel}</div>
                                    </div>
                                ))
                            ) : (
                                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No results found.</div>
                            )}
                        </div>
                    ) : (
                        helpData.map(cat => (
                            <div key={cat.id} className="nav-category">
                                <div
                                    className={`nav-category-header ${cat.class || ''} ${expandedCategories.includes(cat.id) ? 'active' : ''}`}
                                    onClick={() => toggleCategory(cat.id)}
                                >
                                    {cat.icon}
                                    <span style={{ flex: 1 }}>{cat.label}</span>
                                    {expandedCategories.includes(cat.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </div>

                                {expandedCategories.includes(cat.id) && (
                                    <div className="nav-group-articles animate-slide-down">
                                        {cat.articles.map(article => (
                                            <div
                                                key={article.id}
                                                className={`nav-article-link ${activeArticle === article.id ? 'active' : ''}`}
                                                onClick={() => {
                                                    setActiveArticle(article.id);
                                                    setMobileMenuOpen(false);
                                                }}
                                            >
                                                {article.title}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div style={{ padding: 20, borderTop: '1px solid var(--border-glass)' }}>
                    <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => window.open('mailto:support@woodash.app')}>
                        <Mail size={16} /> Contact Support
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="help-content-area">
                {currentArticle ? (
                    <div className="help-content-wrapper animate-fade-in">
                        <div className="article-breadcrumb">
                            <Book size={14} /> Documentation <ChevronRight size={12} /> {currentArticle.categoryLabel}
                        </div>
                        <h1 className="article-title">{currentArticle.title}</h1>
                        <div className="article-body">
                            {currentArticle.content}
                        </div>

                        <div className="article-footer">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span>Last updated: {new Date().toLocaleDateString()}</span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {currentArticle.id}</span>
                            </div>

                            <div className="feedback-section">
                                <span style={{ marginRight: 12 }}>Was this helpful?</span>
                                <div className="feedback-buttons">
                                    <button className="btn-feedback" title="Yes">
                                        <ThumbsUp size={16} />
                                    </button>
                                    <button className="btn-feedback" title="No">
                                        <ThumbsDown size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
                        <Search size={64} strokeWidth={1} style={{ marginBottom: 16 }} />
                        <h3>Select an article to view</h3>
                        <p>Or use the search bar to find answers.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Help;
