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

We need to make the picklist only show products that have track inventory enabled.

---

## ✅ Completed

- [x] **Client Build Failure**: TypeScript errors resolved
- [x] **AutomationEngine Filters**: Detailed filter logic implemented
- [x] **AutomationEngine Templates**: Real email template rendering
- [x] **AdsService ROAS**: Parse `action_values` for ROAS
- [x] **Webhook Security**: `webhookSecret` verification added
- [x] **Email Encryption**: Encrypted email passwords
- [x] **Dynamic Currency**: Analytics currency fetching
- [x] **EmailSettings Refactor**: Removed `@ts-nocheck`
- [x] **Widget Typing**: Explicit types for chart formatters
- [x] **Schema Update**: `webhookSecret` added to Account model