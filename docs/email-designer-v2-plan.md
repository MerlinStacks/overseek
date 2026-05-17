# Overseek Native Email Designer V2 Master Plan

## Goal

Replace Unlayer with a native Overseek email designer that integrates deeply with WooCommerce, Overseek automations, account branding, and multi-tenant data, while preserving current campaign/template workflows and enabling long-term product differentiation.

## Decisions Locked

- **Launch strategy:** Parallel beta (feature-flagged), with Unlayer fallback.
- **Source of truth:** Overseek-native JSON model in `designJson`, compiled HTML in `content`.
- **Legacy compatibility:** Best-effort auto-migration from Unlayer JSON, with fallback for unsupported structures.

## Current State (Repository Findings)

- Editor currently powered by `react-email-editor` (Unlayer):
  - `client/src/components/marketing/EmailDesignEditor.tsx`
- Custom WooCommerce/marketing blocks:
  - `client/src/lib/unlayerWooCommerceTools.ts`
- Save pipeline already persists:
  - `content` (rendered HTML)
  - `designJson` (builder state)
- Models already support this:
  - `EmailTemplate` and `MarketingCampaign` in `server/prisma/schema.prisma`
- Server-side merge-tag resolution is editor-agnostic:
  - `server/src/services/MergeTagResolver.ts`
- Editor entry points:
  - Campaign pages: `client/src/pages/MarketingPage.tsx`, `client/src/pages/BroadcastsPage.tsx`
  - Automation send-email config: `client/src/components/marketing/SendEmailConfig.tsx`
  - Template flows: `client/src/components/marketing/flow/*`

---

## Architecture Direction

## 1) Canonical Document Model

Use versioned `designJson` envelope:

```json
{
  "engine": "overseek-v2",
  "version": 1,
  "document": {}
}
```

Legacy documents may remain as `engine: "unlayer"`.

### Proposed V2 primitives

- `document`
  - `meta` (title, previewText, category, locale)
  - `theme` (font, colors, spacing, button tokens)
  - `sections[]`
- `section`
  - `id`, `visibility`, `background`, `padding`, `columns[]`
- `column`
  - `id`, `width`, `blocks[]`
- `block` (union)
  - `type`: `text | image | button | divider | spacer | product | orderSummary | address | coupon | rawHtml | reusableRef | dynamic`
  - `props`, `conditions`, `tracking`
- `reusableRef`
  - pointer to shared account-scoped reusable asset
- `dynamic`
  - conditional wrapper for segment/profile/order-driven display rules

## 2) Rendering and Send Contract

- Compile `designJson` -> deterministic email-safe HTML (table layout + inline styles).
- Preserve merge tags in frontend output; resolve server-side only.
- Save compiled HTML to `content`.
- Use same compiler for preview and send-path parity.
- Support fallback output for unsupported blocks (`rawHtml` with warning metadata).

## 3) Core Editor Surface (Parity + Better)

- Drag/drop structure (sections/rows/columns/blocks)
- Starter layouts
- Reusable headers/footers and shared sections
- Autosave drafts
- Version snapshots + restore
- Preflight checklist
- Test-send panel
- Merge tag insertion UX
- Mobile + desktop preview

## 4) Integration Points

- Campaign editor uses V2 via feature flag.
- Broadcast editor uses V2 via feature flag.
- Automation "Send Email" visual mode uses V2.
- Template selector is engine-aware (`unlayer` vs `overseek-v2` badges).

## 5) Legacy Migration Strategy

- Converter: Unlayer JSON -> V2 JSON.
- Supported block mappings convert directly.
- Unsupported nodes become `rawHtml` blocks + migration warnings.
- UI shows migration report:
  - converted cleanly
  - converted with fallback
  - needs manual attention

## 6) Rollout and Risk Control

- Account-level flag: `EMAIL_DESIGNER_V2`
- Rollout phases:
  1. Internal accounts
  2. Pilot accounts
  3. Wider beta
  4. Default-on
  5. Unlayer deprecation/removal
- Telemetry:
  - editor open/save/export
  - test-send success/failure
  - migration success rate
  - fallback usage
  - unsupported block frequency

## 7) Testing Strategy

### Unit
- Compiler snapshots by block/type/theme variation
- Merge-tag preservation tests
- Migration mapping tests using real Unlayer fixtures

### Integration
- Campaign save/load/send
- Template save/select/apply
- Automation node edit/save/execute using visual template

### Regression
- V2 HTML + `MergeTagResolver` parity
- Rendering validation for major clients (Gmail, Outlook, Apple Mail)

---

## Competitive Feature Gaps to Include in V2 Plan

Compared with mainstream designers (Unlayer, Beefree/RGE Studio, Mailchimp, Klaviyo, Braze), these capabilities should be planned into Overseek V2.

## A) Collaboration (No Approval Workflow)

- Inline comments/threads on blocks and sections
- Role-based permissions for drafting and publishing actions
- Optional presence/co-editing roadmap (phase 2+)

## B) Advanced Versioning and Auditability

- Structured revision history (who/when/what)
- Restore points with visual diff metadata

## C) Brand Governance and Multi-Brand Ops

- Brand kit (fonts/colors/button styles/logo presets)
- Lockable style tokens (enforce design consistency)
- Multi-brand workspaces per account (or per business unit)
- Brand-level reusable block libraries

## D) Mobile-Specific Design Controls

- Per-block hide/show desktop/mobile
- Column stack controls:
  - normal stack
  - reverse stack
  - do-not-stack
- Mobile-only spacing/typography overrides where safe

## E) Content and Asset Studio

- Central media library with tags/folders/search
- Asset reuse across campaigns/templates/automations
- Image metadata support (alt text required checks)
- Future: transformations (resize/compress/crop) and CDN policy controls

## F) Dynamic/Conditional Content in Visual Builder

- Rule builder for conditional blocks based on:
  - profile fields
  - segment membership
  - order/cart attributes
- Preview with sample personas or test payloads

## G) Experimentation and Optimization

- Variant authoring from same design
- A/B setup for subject/content/CTA options
- Tie into campaign analytics for winner selection
- Future: send-time optimization hooks

## H) AI-Assisted Creation

- AI copy assist (draft/rewrite/shorten/expand/tone)
- Subject line suggestions
- Preflight AI QA hints (clarity, CTA strength, deliverability cues)
- Optional product-aware content suggestions from Woo data

## I) Deliverability-Aware Authoring

- Spam-risk heuristic checks
- Link/URL integrity checks
- Image-to-text guidance
- Missing required elements warnings (unsubscribe, physical address if needed)

---

## Prioritized Roadmap (Updated)

## P0 — Foundation + Safe Beta (must-have)

- V2 document schema + compiler
- Feature-flagged V2 editor MVP
- Legacy migration with fallback
- Mobile controls (hide/show + stack rules)
- Improved version history + restore
- Baseline asset library
- Campaign + automation + templates integration
- Telemetry + migration observability

## P1 — Competitive Parity

- Collaboration comments
- Brand kit + lockable style tokens
- Conditional content/rule builder
- A/B variant authoring workflow
- Deliverability assistant (rule-based)

## P2 — Differentiation

- AI copy + subject + QA assistant
- Advanced optimization workflows

---

## Milestones

## Milestone 1 (Week 1)
- Finalize schema and compiler contracts
- Add engine/version envelope
- Implement deterministic HTML renderer
- Set up feature flag plumbing

## Milestone 2 (Weeks 2-3)
- Build V2 editor MVP and parity UX
- Integrate campaign editors
- Add version history baseline and mobile controls

## Milestone 3 (Week 4)
- Integrate automation send-email and templates flow
- Ship migration pipeline + migration report UI
- Add asset library baseline

## Milestone 4 (Week 5)
- Internal + pilot rollout
- Measure telemetry, close parity gaps
- Stabilize send/preview consistency

## Milestone 5 (Week 6+)
- P1 features (comments, brand kits, conditional blocks, deliverability checks)
- Wider beta rollout

## Milestone 6 (Post-beta)
- P2 differentiation (AI, advanced optimization)
- Plan and execute Unlayer deprecation

---

## Exit Criteria for Full Cutover

- Migration success (clean conversion) meets threshold target
- Fallback usage trends down to acceptable baseline
- Save/test-send success at or above Unlayer baseline
- No critical rendering regressions in key email clients
- Support burden stable over 30-day default-on window
- Confidence to remove `react-email-editor`/Unlayer dependencies
