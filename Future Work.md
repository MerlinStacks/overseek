# Future Work & Roadmap

This document tracks planned enhancements, known bugs, and future feature ideas for the OverSeek platform.

---

## 🔧 Settings & Configuration

## 📣 Unified Marketing

- [ ] **SMS & WhatsApp Channels**: Extend `MarketingAutomation` to support SMS/WhatsApp nodes via Twilio
- [ ] **Lead Capture Builder**: Popup/form builder linked to `CustomerSegment`s with Exit Intent triggers

---

## 🏷️ Orders & Tags

- [ ] **Order Filtering**: Robust filtering by product and order tags

---

## �️ Mobile & UI

- [ ] **Full-Screen Modals**: Optimize `OrderPreviewModal` and `CustomerDetails` for small screens
- [ ] **Tab Stacking**: Vertically stack horizontal tabs on narrow screens

---

## 🏭 Advanced Operations

- [ ] **Scheduled Reports**: Automated email delivery of custom report segments
- [ ] **Janitor Jobs**: Cron jobs for data retention and pruning

---

## 🔒 Security & Technical Debt

- [ ] **Webhook Secret Logic**: Complete implementation in `webhook.ts`
- [ ] **Credential Encryption**: Encryption-at-rest for email credentials
- [ ] **AutomationEngine Filters**: Detailed filter implementation
- [ ] **CI/CD Optimization**: Optimized Docker layers