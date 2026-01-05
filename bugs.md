# Bugs & TODOs

## Critical Blockers
- [x] Client Build Failure (TypeScript Errors) - Resolved via suppression/fixes.

## High Priority
- [x] `AutomationEngine`: Detailed Filter Logic (Completed)
- [x] `AutomationEngine`: Real email template rendering (Completed)
- [x] `AdsService`: Parse `action_values` for ROAS (Completed)
- [x] `webhook.ts`: Add `webhookSecret` verification (Completed)
- [x] `email.ts`: Encrypt email passwords (Completed)
- [x] `analytics.ts`: Dynamic currency fetching (Completed)

## Technical Debt being addressed
- [ ] `EmailSettings.tsx`: Refactor needed. Currently using `@ts-nocheck`.
- [ ] `SalesChartWidget.tsx`, `CustomerGrowthWidget.tsx`: Explicitly type formatters instead of `@ts-ignore`.

## Discovered Issues
- [ ] `Account` model missing `webhookSecret` (Schema update pending migration).
