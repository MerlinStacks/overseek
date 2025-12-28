import React, { useState, useMemo } from 'react';
import {
    Book, MessageCircle, ShoppingBag, BarChart2, Shield,
    Search, ChevronRight, Zap, Package, MapPin, Edit2,
    HelpCircle, Code, Layers, ChevronDown, Database, Lock, Globe
} from 'lucide-react';

const Help = () => {
    // Navigation State
    const [expandedCategories, setExpandedCategories] = useState(['getting-started']);
    const [activeArticle, setActiveArticle] = useState('welcome');
    const [searchTerm, setSearchTerm] = useState('');

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
                            <p className="help-lead">WooDash is a high-performance, local-first dashboard for WooCommerce built for speed.</p>
                            <div className="help-alert info">
                                <strong>Core Philosophy:</strong> We bring the database to you. By syncing your store data to IndexDB, we achieve 0ms latency interactions.
                            </div>
                            <h3>Key Features</h3>
                            <ul className="help-list">
                                <li><strong>Zero Latency:</strong> Search 10,000 orders instantly, no server round-trips.</li>
                                <li><strong>Offline Capable:</strong> View data and queue edits without internet.</li>
                                <li><strong>Real-Time:</strong> Live visitor tracking and cart monitoring.</li>
                            </ul>
                        </div>
                    )
                },
                {
                    id: 'connecting-store',
                    title: 'Connecting Your Store',
                    content: (
                        <div>
                            <p>Connect your WooCommerce store securely using REST API keys.</p>
                            <h3>Step-by-Step Guide</h3>
                            <ol className="help-ol">
                                <li>Go to <strong>Settings &gt; General</strong> in WooDash.</li>
                                <li>Enter your <strong>Store URL</strong> (e.g., <code>https://mystore.com</code>).</li>
                                <li>Generate keys in WooCommerce: <em>Settings &gt; Advanced &gt; REST API &gt; Add Key</em>.</li>
                                <li>Ensure permissions are set to <strong>Read/Write</strong>.</li>
                                <li>Copy the <strong>Consumer Key</strong> and <strong>Consumer Secret</strong> into the dashboard.</li>
                            </ol>
                            <div className="help-alert warning">
                                <strong>Troubleshooting:</strong> If you receive a "Network Error", try changing the <strong>Auth Method</strong> to "Query String" in Settings. This bypasses common server firewall rules.
                            </div>
                        </div>
                    )
                },
                {
                    id: 'requirements',
                    title: 'System Requirements',
                    content: (
                        <div>
                            <p>WooDash runs entirely in your browser. We leverage modern web technologies (IndexDB, Web Workers) to handle data.</p>
                            <table className="help-table">
                                <thead>
                                    <tr>
                                        <th>Component</th>
                                        <th>Requirement</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Browser</td>
                                        <td>Chrome 90+, Edge 90+, Firefox 90+</td>
                                    </tr>
                                    <tr>
                                        <td>RAM</td>
                                        <td>8GB+ Recommended (for stores with &gt;5k products)</td>
                                    </tr>
                                    <tr>
                                        <td>Storage</td>
                                        <td>~200MB available for local caching</td>
                                    </tr>
                                </tbody>
                            </table>
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
                            <p>To maximize speed without crashing the browser, we use a controlled parallelism strategy:</p>
                            <div className="code-block">
                                <code>
                                    // Pseudo-code constant<br />
                                    const BATCH_SIZE = 3; // Pages fetched in parallel<br />
                                    const PAGE_SIZE = 20; // Items per page
                                </code>
                            </div>
                            <p>We fetch 3 pages at once, process them, and then sequentially write to IndexDB to prevent database locking.</p>

                            <h3>2. Data Enrichment</h3>
                            <p>Raw API data is transformed before storage:</p>
                            <ul>
                                <li><strong>Flattening:</strong> Nested <code>meta_data</code> (like Cost of Goods) is extracted to top-level columns.</li>
                                <li><strong>Guest Extraction:</strong> We scan Order history to create "Virtual Customer" profiles for guest checkouts.</li>
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
                            <p>Traditional dashboards wait for the server on every click. WooDash inverts this.</p>
                            <ul>
                                <li><strong>Reads:</strong> 100% Local. Instant filtering, sorting, and searching.</li>
                                <li><strong>Writes:</strong> Optimistic UI. We update the UI immediately, then sync to the server in the background.</li>
                            </ul>
                            <h3>Compound Primary Keys</h3>
                            <p>To support Multi-tenancy (Multiple Stores), our database schema uses compound keys:</p>
                            <div className="code-block">
                                <code>[account_id + id]</code>
                            </div>
                            <p>This ensures Order #105 from Store A doesn't overwrite Order #105 from Store B.</p>
                        </div>
                    )
                },
                {
                    id: 'security-privacy',
                    title: 'Security & Privacy',
                    content: (
                        <div>
                            <p>Security is a primary design constraint of WooDash.</p>
                            <div className="help-alert success">
                                <strong>No Middleman Server:</strong> Your data goes directly from <em>Your Store</em> &rarr; <em>Your Browser</em>. We (the developers) never see your data.
                            </div>
                            <h3>Encryption</h3>
                            <p>API Keys are stored in <code>localStorage</code>. While secure for personal devices, we recommend locking your workstation when away.</p>
                            <h3>Sandbox</h3>
                            <p>The code runs in a sandboxed browser environment. It cannot access your file system (beyond the approved storage quotas).</p>
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
                            <p>The Orders page is your command center for fulfillment.</p>
                            <h3>Quick Actions</h3>
                            <ul>
                                <li><strong>Status Change:</strong> Click the status badge to cycle through common statuses (Pending &rarr; Processing &rarr; Completed).</li>
                                <li><strong>Private Notes:</strong> Add internal notes that are synced to WooCommerce but only visible to staff.</li>
                            </ul>
                        </div>
                    )
                },
                {
                    id: 'live-carts',
                    title: 'Live Cart Monitoring',
                    content: (
                        <div>
                            <p>See exactly what customers are adding to their cart in real-time. This data travels from the customer's browser to your dashboard in &lt; 2 seconds.</p>
                            <div className="help-alert info">
                                <strong>Privacy Note:</strong> Cart data is ephemeral and cleared after 2 hours of inactivity.
                            </div>
                        </div>
                    )
                },
                {
                    id: 'invoice-builder',
                    title: 'Invoice Builder',
                    content: 'Drag-and-drop builder for PDF invoices. Generates PDFs client-side for maximum privacy.'
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
                    title: 'Recipes (Bundles)',
                    content: (
                        <div>
                            <p>WooDash allows you to create "Virtual Bundles" without a plugin.</p>
                            <h3>How it Works</h3>
                            <p>You define a "Recipe" for a product. E.g., <strong>Gift Box</strong>:</p>
                            <div className="code-block">
                                <code>
                                    1x [SKU-101] Shampoo<br />
                                    2x [SKU-102] Soap Bar
                                </code>
                            </div>
                            <p>The dashboard automatically calculates the <strong>Potential Stock</strong> of the Gift Box based on the ingredients. If you sell a Soap Bar separately, the available Gift Box stock decreases immediately.</p>
                        </div>
                    )
                },
                {
                    id: 'purchase-orders',
                    title: 'Purchase Orders (POs)',
                    content: (
                        <div>
                            <p>Track incoming stock from Suppliers.</p>
                            <ul>
                                <li><strong>Draft:</strong> Planning phase. Items and costs are editable.</li>
                                <li><strong>Ordered:</strong> Confirmed with supplier.</li>
                                <li><strong>Received:</strong> Stock arrives. Clicking "Receive" updates your actual WooCommerce inventory.</li>
                            </ul>
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
                            <p>When chatting with a customer, the <strong>MagicMap</strong> panel shows:</p>
                            <ul>
                                <li><strong>Location:</strong> City/Country inferred from IP.</li>
                                <li><strong>Current Page:</strong> The exact URL they are browsing.</li>
                                <li><strong>Device:</strong> Mobile/Desktop.</li>
                            </ul>
                            <p>This context helps you provide proactive support without asking "What are you looking at?".</p>
                        </div>
                    )
                },
                {
                    id: 'segments',
                    title: 'Customer Segments',
                    content: 'Create dynamic groups like "VIPs" (Spent > $500) or "Local" (City = "New York"). These segments sync to the Automation engine.'
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
                            <p>Automate your marketing with a node-based editor.</p>
                            <h3>Node Types</h3>
                            <ul>
                                <li><strong>Triggers:</strong> Order Created, Cart Abandoned, Review Posted.</li>
                                <li><strong>Logic:</strong> Delays (Time), Conditionals (If/Else), Splits.</li>
                                <li><strong>Actions:</strong> Send Email, Add Tag, HTTP Webhook.</li>
                            </ul>
                        </div>
                    )
                },
                {
                    id: 'coupons',
                    title: 'Coupons Management',
                    content: 'Create and manage dynamic coupons. Track usage stats and set complex expiry rules.'
                }
            ]
        },
        {
            id: 'analytics',
            label: 'Analytics & Reports',
            icon: <BarChart2 size={18} />,
            articles: [
                {
                    id: 'visitor-log',
                    title: 'Visitor Log',
                    content: 'Track real-time traffic human vs bots. See source, location, and full session journey history.'
                },
                {
                    id: 'forecasting',
                    title: 'Forecasting Logic',
                    content: (
                        <div>
                            <p>The dashboard projects future revenue using <strong>Linear Regression</strong> on your last 90 days of sales data.</p>
                            <p>It calculates a <code>trend_slope</code> to determine if your store is growing or shrinking day-over-day.</p>
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
                    id: 'granular-sync',
                    title: 'Granular Sync',
                    content: 'Choose which entities to sync (Products, Orders, Customers) to speed up performance on large stores.'
                },
                {
                    id: 'ai-settings',
                    title: 'AI Intelligence',
                    content: 'Configure OpenRouter API keys to enable smart inbox replies and natural language report queries.'
                }
            ]
        }
    ];

    // --- Derived State for View ---
    const allArticles = useMemo(() => helpData.flatMap(cat => cat.articles.map(art => ({ ...art, categoryId: cat.id, categoryLabel: cat.label }))), []);

    const currentArticle = useMemo(() => {
        return allArticles.find(a => a.id === activeArticle);
    }, [activeArticle, allArticles]);

    const searchResults = useMemo(() => {
        if (!searchTerm) return [];
        return allArticles.filter(a => {
            const rawText = typeof a.content === 'string' ? a.content : 'complex content';
            return a.title.toLowerCase().includes(searchTerm.toLowerCase()) || rawText.toLowerCase().includes(searchTerm.toLowerCase());
        });
    }, [searchTerm, allArticles]);

    return (
        <div className="page-container help-page-container">
            <style>{`
                .help-page-container {
                    display: flex;
                    height: 100%;
                    background: var(--bg-app);
                    overflow: hidden;
                }
                .help-sidebar {
                    width: 300px;
                    background: var(--bg-panel);
                    border-right: 1px solid var(--border-light);
                    display: flex;
                    flex-direction: column;
                }
                .help-search-area {
                    padding: 20px;
                    border-bottom: 1px solid var(--border-light);
                    position: relative;
                }
                .help-nav {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                }
                .nav-category-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 12px;
                    cursor: pointer;
                    color: var(--text-main);
                    font-weight: 600;
                    border-radius: 6px;
                    user-select: none;
                    transition: background 0.2s;
                }
                .nav-category-header:hover {
                    background: rgba(0,0,0,0.03);
                }
                .nav-category-header.advanced {
                    color: var(--primary);
                }
                .nav-article-link {
                    display: block;
                    padding: 8px 12px 8px 42px;
                    color: var(--text-secondary);
                    font-size: 0.95rem;
                    cursor: pointer;
                    border-radius: 6px;
                    text-decoration: none;
                    margin-bottom: 2px;
                }
                .nav-article-link:hover {
                    background: rgba(0,0,0,0.03);
                    color: var(--text-main);
                }
                .nav-article-link.active {
                    background: var(--primary-light);
                    color: var(--primary);
                    font-weight: 500;
                }
                
                .help-content-area {
                    flex: 1;
                    padding: 40px 60px;
                    overflow-y: auto;
                    max-width: 1000px;
                }
                .article-breadcrumb {
                    font-size: 0.9rem;
                    color: var(--text-muted);
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .article-title {
                    font-size: 2.2rem;
                    font-weight: 700;
                    margin-bottom: 32px;
                    color: var(--text-main);
                }
                .article-body {
                    line-height: 1.7;
                    color: var(--text-secondary);
                    font-size: 1.05rem;
                }
                .article-body h3 {
                    margin-top: 32px;
                    margin-bottom: 16px;
                    font-size: 1.4rem;
                    color: var(--text-main);
                }
                .article-body ul, .article-body ol {
                    margin-bottom: 24px;
                    padding-left: 24px;
                }
                .article-body li {
                    margin-bottom: 8px;
                }
                
                .help-alert {
                    padding: 16px;
                    border-radius: 8px;
                    margin: 24px 0;
                    border-left: 4px solid;
                }
                .help-alert.info { background: rgba(59, 130, 246, 0.1); border-color: #3b82f6; }
                .help-alert.warning { background: rgba(245, 158, 11, 0.1); border-color: #f59e0b; }
                .help-alert.success { background: rgba(16, 185, 129, 0.1); border-color: #10b981; }

                .code-block {
                    background: #1e293b;
                    color: #e2e8f0;
                    padding: 16px;
                    border-radius: 8px;
                    font-family: monospace;
                    margin: 16px 0;
                    overflow-x: auto;
                }
                .help-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 24px 0;
                }
                .help-table th, .help-table td {
                    border: 1px solid var(--border-light);
                    padding: 12px;
                    text-align: left;
                }
                .help-table th {
                    background: var(--bg-subtle);
                    font-weight: 600;
                }
            `}</style>

            {/* Sidebar */}
            <div className="help-sidebar">
                <div className="help-search-area">
                    <Search size={16} style={{ position: 'absolute', left: 32, top: 32, color: 'var(--text-muted)' }} />
                    <input
                        type="text"
                        className="input-field"
                        placeholder="Search documentation..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ paddingLeft: 40, width: '100%' }}
                    />
                </div>

                <div className="help-nav">
                    {searchTerm ? (
                        <div>
                            <div style={{ padding: '0 12px 8px', fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                            <div key={cat.id} style={{ marginBottom: 8 }}>
                                <div
                                    className={`nav-category-header ${cat.class || ''}`}
                                    onClick={() => toggleCategory(cat.id)}
                                >
                                    {cat.icon}
                                    <span style={{ flex: 1 }}>{cat.label}</span>
                                    {expandedCategories.includes(cat.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </div>

                                {expandedCategories.includes(cat.id) && (
                                    <div className="nav-group-articles">
                                        {cat.articles.map(article => (
                                            <div
                                                key={article.id}
                                                className={`nav-article-link ${activeArticle === article.id ? 'active' : ''}`}
                                                onClick={() => setActiveArticle(article.id)}
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
            </div>

            {/* Main Content */}
            <div className="help-content-area">
                {currentArticle ? (
                    <div className="animate-fade-in">
                        <div className="article-breadcrumb">
                            <Book size={14} /> Documentation <ChevronRight size={12} /> {currentArticle.categoryLabel}
                        </div>
                        <h1 className="article-title">{currentArticle.title}</h1>
                        <div className="article-body">
                            {currentArticle.content}
                        </div>

                        <div style={{ marginTop: 60, paddingTop: 20, borderTop: '1px solid var(--border-light)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            Last updated: {new Date().toLocaleDateString()} &bull; <span style={{ cursor: 'pointer', textDecoration: 'underline' }}>Report an issue</span>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
                        <Search size={48} />
                        <p>Select an article to view</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Help;
