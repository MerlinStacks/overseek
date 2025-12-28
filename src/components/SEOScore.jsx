import React, { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, TrendingUp, Search, ShoppingBag } from 'lucide-react';
import './SEOScore.css';

const SEOScore = ({ data, keyword, onKeywordChange }) => {
    const [activeTab, setActiveTab] = useState('general');

    const analysis = useMemo(() => {
        const tests = [];
        const mainKeyword = (keyword || '').toLowerCase().trim();
        const title = (data.name || '').toLowerCase();
        const desc = (data.description || '').toLowerCase(); // Use full HTML or strip? Better to strip for counting
        const descText = desc.replace(/<[^>]*>/g, ' ');
        const shortDesc = (data.short_description || '').toLowerCase().replace(/<[^>]*>/g, ' ');
        const slug = (data.slug || data.name || '').toLowerCase().replace(/ /g, '-');

        // 1. Keyword Checks
        if (!mainKeyword) {
            tests.push({ id: 'kw_missing', status: 'fail', label: 'Focus Keyword', desc: 'Please set a focus keyword to start analysis.' });
            return { score: 0, tests };
        }

        // Title
        if (title.includes(mainKeyword)) {
            tests.push({ id: 'title_kw', status: 'pass', label: 'Keyword in Title', desc: 'Focus keyword found in product title.' });
        } else {
            tests.push({ id: 'title_kw', status: 'fail', label: 'Keyword in Title', desc: 'Add focus keyword to the product title.' });
        }

        if (title.startsWith(mainKeyword)) {
            tests.push({ id: 'title_start', status: 'pass', label: 'Title Starts with Keyword', desc: 'Title starts with focus keyword.' });
        } else {
            tests.push({ id: 'title_start', status: 'warn', label: 'Title Starts with Keyword', desc: 'Try to place the keyword at the beginning of the title.' });
        }

        // Desc
        if (descText.includes(mainKeyword) || shortDesc.includes(mainKeyword)) {
            tests.push({ id: 'desc_kw', status: 'pass', label: 'Keyword in Description', desc: 'Focus keyword found in description.' });
        } else {
            tests.push({ id: 'desc_kw', status: 'fail', label: 'Keyword in Description', desc: 'Add focus keyword to the product description.' });
        }

        // URL
        if (slug.includes(mainKeyword.replace(/ /g, '-'))) {
            tests.push({ id: 'url_kw', status: 'pass', label: 'Keyword in URL', desc: 'Focus keyword found in URL slug.' });
        } else {
            tests.push({ id: 'url_kw', status: 'fail', label: 'Keyword in URL', desc: 'Focus keyword missing from URL slug.' });
        }

        // 2. Content Length
        const wordCount = descText.split(/\s+/).filter(n => n != '').length;
        if (wordCount > 300) {
            tests.push({ id: 'length', status: 'pass', label: 'Content Length', desc: `Great content length (${wordCount} words).` });
        } else if (wordCount > 100) {
            tests.push({ id: 'length', status: 'warn', label: 'Content Length', desc: `Content is a bit short (${wordCount} words). Aim for 300+.` });
        } else {
            tests.push({ id: 'length', status: 'fail', label: 'Content Length', desc: `Content is too short (${wordCount} words). Elaborate on the product.` });
        }

        // 3. Title Length
        if (title.length >= 10 && title.length <= 60) {
            tests.push({ id: 'title_len', status: 'pass', label: 'Title Length', desc: `Perfect title length (${title.length} chars).` });
        } else if (title.length < 10) {
            tests.push({ id: 'title_len', status: 'fail', label: 'Title Length', desc: 'Title is too short.' });
        } else {
            tests.push({ id: 'title_len', status: 'warn', label: 'Title Length', desc: 'Title is too long, could be truncated.' });
        }

        // Calculate Score
        const passed = tests.filter(t => t.status === 'pass').length;
        const total = tests.length; // Don't count the initial fail if no keyword
        const score = Math.round((passed / total) * 100);

        return { score, tests };
    }, [data, keyword]);

    // Google Merchant Center Analysis
    const gmcAnalysis = useMemo(() => {
        const tests = [];
        const { price, main_image, permalink, stock_status, sku, attributes = [], meta_data = [], description } = data;
        const title = data.name || '';

        // 1. Basic Requirements
        if (title && title.length > 0 && title.length <= 150) {
            tests.push({ id: 'gmc_title', status: 'pass', label: 'Title Present', desc: 'Title is present and within length limits.' });
        } else {
            tests.push({ id: 'gmc_title', status: 'fail', label: 'Title Issue', desc: 'Title missing or too long (>150 chars).' });
        }

        if (description && description.length > 0) {
            tests.push({ id: 'gmc_desc', status: 'pass', label: 'Description Present', desc: 'Product description is available.' });
        } else {
            tests.push({ id: 'gmc_desc', status: 'fail', label: 'Description Missing', desc: 'Google requires a description.' });
        }

        if (main_image) {
            tests.push({ id: 'gmc_img', status: 'pass', label: 'Image Present', desc: 'Main product image is set.' });
        } else {
            tests.push({ id: 'gmc_img', status: 'fail', label: 'Image Missing', desc: 'A main image is required.' });
        }

        if (permalink) {
            tests.push({ id: 'gmc_link', status: 'pass', label: 'Link Valid', desc: 'Product permalink is available.' });
        } else {
            tests.push({ id: 'gmc_link', status: 'fail', label: 'Link Missing', desc: 'Permalink is required.' });
        }

        if (price !== undefined && price !== '' && price !== null) {
            tests.push({ id: 'gmc_price', status: 'pass', label: 'Price Set', desc: 'Product price is set.' });
        } else {
            tests.push({ id: 'gmc_price', status: 'fail', label: 'Price Missing', desc: 'Price is required.' });
        }

        if (stock_status) { // instock, outofstock, onbackorder are all valid values mapped appropriately, just need one set
            tests.push({ id: 'gmc_stock', status: 'pass', label: 'Availability', desc: `Availability status: ${stock_status}.` });
        } else {
            tests.push({ id: 'gmc_stock', status: 'fail', label: 'Availability Missing', desc: 'Stock status is required.' });
        }

        // 2. Unique Product Identifiers (GTIN, MPN, Brand)
        // Check attributes for 'brand', 'gtin', 'ean', 'upc'
        const brandAttr = attributes.find(a => a.name.toLowerCase() === 'brand' || a.name.toLowerCase() === 'manufacturer');
        const brandMeta = meta_data.find(m => m.key === '_brand'); // Example meta key
        const hasBrand = (brandAttr && brandAttr.options && brandAttr.options.length > 0) || brandMeta;

        const gtinAttr = attributes.find(a => ['gtin', 'ean', 'upc', 'isbn'].includes(a.name.toLowerCase()));
        const gtinMeta = meta_data.find(m => m.key === '_gtin' || m.key === '_ean');
        const hasGTIN = (gtinAttr && gtinAttr.options && gtinAttr.options.length > 0) || gtinMeta;

        const hasMPN = sku || meta_data.find(m => m.key === '_mpn');

        if (hasBrand) {
            tests.push({ id: 'gmc_brand', status: 'pass', label: 'Brand', desc: 'Brand is specified.' });
        } else {
            tests.push({ id: 'gmc_brand', status: 'warn', label: 'Brand Missing', desc: 'Brand is recommended (required for most).' });
        }

        if (hasGTIN) {
            tests.push({ id: 'gmc_gtin', status: 'pass', label: 'GTIN/EAN', desc: 'GTIN identifier found.' });
        } else {
            // If no GTIN, MPN + Brand is often enough, or "identifier_exists=no"
            if (hasBrand && hasMPN) {
                tests.push({ id: 'gmc_gtin', status: 'pass', label: 'Identifiers', desc: 'Brand + MPN (SKU) used in place of GTIN.' });
            } else {
                tests.push({ id: 'gmc_gtin', status: 'warn', label: 'Unique Identifiers', desc: 'GTIN or (Brand + MPN) recommended.' });
            }
        }

        const passed = tests.filter(t => t.status === 'pass').length;
        const total = tests.length;
        const score = Math.round((passed / total) * 100);

        return { score, tests };

    }, [data]);

    const getScoreColor = (s) => {
        if (s >= 80) return 'score-high';
        if (s >= 50) return 'score-med';
        return 'score-low';
    };

    return (
        <div className="seo-score-container">
            <div className="seo-header" style={{ justifyContent: 'space-between', alignItems: 'center', display: 'flex' }}>
                <div className="seo-title">
                    <TrendingUp size={20} color="#6366f1" />
                    <span>Optimization</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <div className={`seo-score-pill ${getScoreColor(analysis.score)}`} title="SEO Score">
                        <span style={{ fontSize: '0.7em', opacity: 0.8 }}>SEO</span> {analysis.score}
                    </div>
                    <div className={`seo-score-pill ${getScoreColor(gmcAnalysis.score)}`} title="Google Merchant Center Score">
                        <span style={{ fontSize: '0.7em', opacity: 0.8 }}>GMC</span> {gmcAnalysis.score}
                    </div>
                </div>
            </div>

            <div className="seo-input-group">
                <label>Focus Keyword</label>
                <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', top: '12px', color: '#94a3b8' }} />
                    <input
                        className="seo-keyword-input"
                        style={{ paddingLeft: '34px' }}
                        value={keyword}
                        onChange={(e) => onKeywordChange(e.target.value)}
                        placeholder="Enter main keyword..."
                    />
                </div>
            </div>

            <div className="seo-tabs">
                <button className={`seo-tab ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>SEO</button>
                <button className={`seo-tab ${activeTab === 'google' ? 'active' : ''}`} onClick={() => setActiveTab('google')}>
                    <ShoppingBag size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} /> Google
                </button>
                <button className={`seo-tab ${activeTab === 'social' ? 'active' : ''}`} onClick={() => setActiveTab('social')}>Social</button>
            </div>

            <div className="seo-content-scroll" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {activeTab === 'general' && (
                    <div className="seo-checklist">
                        {analysis.tests.map((test, i) => (
                            <div key={i} className="seo-check-item">
                                <div className="check-icon">
                                    {test.status === 'pass' && <CheckCircle2 size={18} className="check-pass" />}
                                    {test.status === 'fail' && <XCircle size={18} className="check-fail" />}
                                    {test.status === 'warn' && <AlertTriangle size={18} className="check-warn" />}
                                </div>
                                <div className="check-content">
                                    <span className="check-label">{test.label}</span>
                                    <span className="check-desc">{test.desc}</span>
                                </div>
                            </div>
                        ))}
                        {analysis.tests.length === 0 && <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Enter a keyword to see analysis.</p>}
                    </div>
                )}

                {activeTab === 'google' && (
                    <div className="seo-checklist">
                        {gmcAnalysis.tests.map((test, i) => (
                            <div key={i} className="seo-check-item">
                                <div className="check-icon">
                                    {test.status === 'pass' && <CheckCircle2 size={18} className="check-pass" />}
                                    {test.status === 'fail' && <XCircle size={18} className="check-fail" />}
                                    {test.status === 'warn' && <AlertTriangle size={18} className="check-warn" />}
                                </div>
                                <div className="check-content">
                                    <span className="check-label">{test.label}</span>
                                    <span className="check-desc">{test.desc}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'social' && (
                    <div style={{ padding: '20px 0', textAlign: 'center', color: '#94a3b8' }}>
                        Social media previews coming soon.
                    </div>
                )}
            </div>
        </div>
    );
};

export default SEOScore;
