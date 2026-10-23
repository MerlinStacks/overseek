# Meta creative analysis

In Marketing → Ad Performance, expand a Meta campaign, then an ad set. Below the ads table, **Creative analysis** compares the current creative IDs used by ads with activity in the selected period.

## What is available

- Available image previews and video thumbnails, primary text, headlines, descriptions and calls to action.
- Spend, impressions, CTR, purchases, purchase revenue, CPA and ROAS. Ads reusing the same current creative ID are grouped, using summed base metrics and weighted ratios.
- Per-ad frequency, current delivery status and potential fatigue signals.
- An on-demand AI review with strengths, concerns and draft copy/visual test ideas. This never changes a live ad.

## AI configuration and consent

Configure the account’s OpenRouter key and model in Settings → AI. Nothing is sent to AI merely by opening the report. Clicking **Analyze creative** sends copy, metrics and comparison metrics from the selected ad set. Provider usage charges may apply.

The separate image checkbox defaults to off. When enabled, up to four available Meta-hosted preview images are supplied if the configured model can be verified as image-capable. Otherwise the review explicitly falls back to text and metrics. Video review is thumbnail-only, not playback, motion, audio or an assessment of the complete video.

## Fatigue signals

The selected period must cover at least 15 days. Compare the latest seven complete days with the preceding seven complete days, excluding today. Each window needs at least 1,000 impressions and 20 clicks.

A potential signal requires an ad with recent frequency ≥3 and at least 1,000 recent impressions, plus either:

- CTR declining by at least 20%; or
- CPA increasing by at least 25%, with at least 10 purchases in each window.

These are operational heuristics, not proof, statistical significance or automatic pause recommendations. The global marketing fatigue advisor uses the same thresholds per ad.

## Reporting limitations

- Results are observational ad-level attribution, not a controlled creative test. Audiences, placements, offers and budgets can affect comparisons.
- Historical ad results may include previous edits; metadata describes the current creative configuration.
- Dynamic/Advantage+ images, text variants and combinations do not receive invented individual performance metrics. The report shows only metadata and results actually returned by Meta.
- Frequency is shown per ad, never summed or averaged into a misleading creative-level unique-reach metric.
- Existing-post, catalog or dynamic ads may omit copy or media. Expired/unavailable previews are shown as unavailable, not replaced with generated media.
- Draft AI advice needs human review and may be inaccurate. Reviews are not persisted across navigation or refresh.

## API

- `GET /api/ads/:adAccountId/creatives?adsetId=<id>&days=<1–365>`: tenant-scoped, paginated Meta metadata and insights.
- `POST /api/ads/:adAccountId/creative-review`: `{ adsetId, creativeId, days, includeVisuals }`. Re-fetches evidence on the server; does not accept client-supplied metrics or media URLs. Defaults to text-only, with a route limit of five requests per minute per IP.
