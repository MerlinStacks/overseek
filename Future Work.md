# Future Work & Roadmap

This document tracks planned enhancements, known bugs, and future feature ideas for the OverSeek platform.

---

## Planned


### Marketplace Sync
- [ ] **Amazon/eBay Inventory Sync**
  - Two-way stock sync
  - Order import from marketplaces
  - Unified product catalog

---

### Shipping & Logistics

- [ ] **Auspost Carrier Integration**
  - Live tracking integration in order detail
  - Shipping label generation from dashboard
  - Delivery exception alerts (notify on delays)
  - Rate lookup and comparison

---

### PWA Enhancements



---


### Customer Intelligence

- [ ] **RFM Segmentation** — Recency, Frequency, Monetary scoring (industry standard)
- [ ] **Behavioral Segments** — Cart abandoners, Browse-no-purchase, One-time vs Repeat
- [ ] **Predictive Churn Scoring** — Identify at-risk customers before they leave
- [ ] **Customer Health Score** — Composite metric from engagement, purchase frequency, support
- [ ] **VIP Detection** — Auto-flag high-value customers for priority treatment

---

### Marketing

- [ ] **SMS Marketing Campaigns** — Marketing SMS alongside email broadcasts
  - SMS automation triggers (abandoned cart, post-purchase)
  - Two-way SMS conversations in inbox
  - Subscriber opt-in/opt-out compliance
  
- [ ] **Email A/B Testing** — Subject line and content testing
- [ ] **Send Time Optimization** — AI-powered optimal send time per recipient
- [ ] **Dynamic Email Content** — Personalized product recommendations in emails

---

### AI Co-Pilot v2: Agency Replacement

The goal is to transform the AI Co-Pilot from a **recommendation engine** into a **full-service autonomous marketing department** that can replace the need for an external digital marketing agency.

#### Tier 1: Content & Creative Engine (P0)

- [ ] **AI Ad Copy Generator**
  - Generate headlines/descriptions from product data (title, description, price, reviews)
  - Platform-specific formatting (Google RSA limits, Meta primary text)
  - Tone/style presets (Professional, Playful, Urgent, Luxury)
  - Bulk generation for entire product catalog
  
- [ ] **Creative A/B Engine**
  - Auto-generate 3-5 copy variants per ad
  - Statistical significance tracking for winner detection
  - Auto-pause underperforming variants after threshold
  - Learning feedback into account-specific style preferences

- [ ] **Product-to-Ad Creative Pipeline**
  - Use product images to generate ad-ready assets
  - Auto-add promotional overlays (% OFF, Free Shipping)
  - Platform-specific sizing (Meta 1:1, Stories 9:16, Display banners)
  - Background removal + lifestyle scene generation

- [ ] **Video Ad Templates**
  - Product slideshow generation from images
  - Animated text overlays with product data merge tags
  - Template library (Unboxing, Before/After, Testimonial)
  - Auto-generate from top-selling products

---

#### Tier 2: Audience Intelligence Integration (P0-P1)

> Connects Customer Intelligence features directly to ad platform actions

- [ ] **RFM → Audience Sync**
  - Auto-create Meta Custom Audiences from RFM segments
  - Google Customer Match integration
  - Scheduled sync (daily refresh of segments)
  - Segment naming convention enforcement

- [ ] **Lookalike Generation**
  - Auto-create lookalikes from top 10% customers
  - Tiered lookalike percentages (1%, 3%, 5%)
  - Cross-platform parity (Meta + Google)

- [ ] **Churn Prevention Campaigns**
  - Trigger win-back campaigns when churn score exceeds threshold
  - Dynamic discount offers based on CLV
  - Multi-touch sequences (email → SMS → retargeting ad)

- [ ] **VIP Targeting**
  - Auto-exclude VIPs from discount campaigns
  - Premium product recommendations for high-CLV segments
  - Exclusive early-access campaign triggers

- [ ] **Behavioral Segment Activation**
  - Cart abandoners → Dynamic retargeting
  - Browse-no-purchase → Category awareness campaigns
  - Repeat buyers → Loyalty/upsell campaigns

---

#### Tier 3: Campaign Lifecycle Automation (P0-P1)

- [ ] **AI Campaign Creation Wizard**
  - Full campaign structure generation from product selection
  - Auto-suggest campaign type (Search, PMax, Advantage+)
  - Budget allocation recommendations based on product margin
  - Keyword/audience targeting auto-population

- [ ] **Auto-Create Campaigns**
  - One-click creation of Google/Meta campaigns from wizard
  - Product feed integration for dynamic ads
  - Automatic ad group/ad set structuring (by category, margin, velocity)

- [ ] **Budget Auto-Rebalancing**
  - Not just suggestions—execute cross-campaign budget shifts
  - ROAS-based reallocation rules
  - Time-of-day/day-of-week budget pacing
  - Spend cap protection with alerts

- [ ] **Bid Strategy Automation**
  - Auto-apply bid strategy recommendations
  - Target ROAS/CPA with guardrails
  - Seasonal bid adjustments (holiday multipliers)
  - Learning period detection and alerts

- [ ] **Campaign Sunset Automation**
  - Auto-pause campaigns below performance thresholds
  - Graduated warnings (Yellow → Orange → Red → Pause)
  - Revival triggers if market conditions change
  - Historical preservation for learning

---

#### Tier 4: Reporting & ROI Attribution (P0)

- [ ] **Weekly Performance Digest**
  - Automated email with key metrics summary
  - AI-written narrative insights ("Revenue up 12% driven by...")
  - Top wins and concerns highlighted
  - Comparison to previous period

- [ ] **Monthly Executive Report**
  - PDF generation with branded template
  - Charts: Spend, Revenue, ROAS trends
  - Campaign-by-campaign breakdown
  - AI recommendations summary

- [ ] **ROI Attribution Dashboard**
  - Track revenue attributed to AI recommendations
  - Cost savings from auto-paused underperformers
  - "Money saved" vs "Money earned" metrics
  - Time savings estimate (hours of manual work avoided)

- [ ] **Action Audit Trail**
  - Complete log of all AI-executed actions
  - Before/after performance snapshots
  - Undo capability for recent actions
  - Export for compliance/review

---

#### Tier 5: Cross-Channel Orchestration (P1)

- [ ] **Multi-Platform Campaign Sync**
  - Mirror campaigns across Google/Meta with platform adjustments
  - Synchronized pause/enable across platforms
  - Cross-platform budget allocation

- [ ] **Seasonal Campaign Templates**
  - Pre-built templates (Black Friday, Christmas, EOFY)
  - Auto-scheduling based on calendar
  - Industry-specific templates (Fashion seasons, etc.)

- [ ] **Multi-Touch Attribution**
  - Cross-channel customer journey mapping
  - Assisted conversion tracking
  - Attribution model selection (Linear, Time-decay, Position-based)

- [ ] **Promotional Calendar**
  - Visual campaign scheduler
  - Conflict detection (overlapping promotions)
  - Automated creative rotation

---

#### Tier 6: Competitive & Market Intelligence (P2)

- [ ] **Competitor Ad Monitoring**
  - Track competitor ad activity (Meta Ad Library, auction insights)
  - Alert on new competitor campaigns
  - Suggested counter-strategies

- [ ] **Industry Benchmarking**
  - Compare performance to industry averages
  - Identify areas of over/under-performance
  - Contextualized recommendations

- [ ] **Trend Detection**
  - Identify rising search terms in category
  - Seasonal trend forecasting
  - Proactive campaign suggestions

- [ ] **Share of Voice Tracking**
  - Impression share monitoring
  - Competitive overlap analysis
  - Budget recommendations to capture lost share

---

#### Tier 7: Landing Page & Conversion (P2)

- [ ] **Landing Page Performance Tracking**
  - Conversion rates per landing page from tracking data
  - Bounce rate correlation with ad performance
  - Page speed impact analysis

- [ ] **Conversion Optimization Suggestions**
  - AI recommendations for page improvements
  - CTA placement and copy suggestions
  - Mobile vs Desktop performance gaps

- [ ] **A/B Test Recommendations**
  - Suggest high-impact tests based on data
  - Statistical significance calculator
  - Winner implementation guidance

---

#### Integration with Existing Features

| Existing Feature | Co-Pilot v2 Integration |
|------------------|------------------------|
| Customer Intelligence (RFM) | Auto-sync segments to ad platforms |
| Predictive Churn | Trigger win-back campaigns |
| FlowBuilder | Connect ad campaigns as automation nodes |
| Learning Engine | Feed creative performance back into generation |
| Inbox/Chat | Trigger campaigns based on conversation sentiment |
| Inventory Forecasting | Pause ads when stock is low |

---



