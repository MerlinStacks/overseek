# Overseek Reviews Roadmap

Plan for replacing CusRev with native Overseek reviews across the WooCommerce plugin, Overseek server, and Overseek dashboard.

## Guiding Decisions

- WooCommerce remains the source of truth for reviews.
- Reviews are stored as native WordPress/WooCommerce product reviews, not in a separate WordPress review table.
- Overseek stores synced review projections for management, automation, search, and analytics.
- Product page review UX should replace the default WooCommerce review form, similar to CusRev.
- Customers should have the lowest-friction email path possible: one-click star links plus reply-to-email reviews.
- Image and video reviews are required.

## Native Data Model

Reviews should be written to WordPress using standard WooCommerce review storage:

- `wp_comments.comment_type = review`
- `wp_comments.comment_post_ID = product_id`
- `wp_comments.comment_approved = 0|1|spam|trash`
- `wp_comments.comment_author`
- `wp_comments.comment_author_email`
- `wp_comments.comment_content`
- `wp_commentmeta.rating`
- `wp_commentmeta.verified`
- `wp_commentmeta.overseek_order_id`
- `wp_commentmeta.overseek_review_token`
- `wp_commentmeta.overseek_media_ids`

Media should be stored as normal WordPress attachments and linked to reviews through comment meta.

## Email Review Approach

Embedded email forms and file uploads are not reliable across email clients, so the supported approach is:

- One-click star links in the email.
- A hosted review form opens with the selected rating prefilled.
- Customers can reply to the review request email with text, photos, and videos.
- Inbound review replies are detected by threading headers or review tokens and converted into pending WooCommerce reviews.
- If a reply cannot be confidently matched, it becomes a manual review item in Overseek.

## Stage 1: Plugin Review Foundation

Goal: Add a native review query and rendering layer in `overseek-wc-plugin`.

Plugin work:

- Add `includes/class-overseek-reviews.php`.
- Add `includes/class-overseek-review-renderer.php`.
- Load both from `includes/class-overseek-main.php`.
- Query reviews using `WP_Comment_Query` and native WooCommerce review metadata.
- Support product filtering, rating filtering, status filtering, pagination, and media lookup.
- Render reusable review cards, compact rows, rating summaries, and media thumbnails.

Deliverables:

- Review list renderer.
- Review summary renderer.
- Product-specific review query.
- No custom storage beyond comment meta.

Success criteria:

- Existing WooCommerce reviews display through the Overseek renderer.
- Product-specific displays only show reviews for that product.
- WooCommerce import/export compatibility remains unchanged.

## Stage 2: Shortcodes

Goal: Allow stores to create review pages and review rows without blocks.

Plugin work:

- Add `[overseek_reviews]`.
- Add `[overseek_review_rows]`.
- Add `[overseek_product_reviews]`.
- Add `[overseek_review_summary]`.
- Add `[overseek_review_form]`.

Shortcode attributes:

- `product_id`
- `limit`
- `page`
- `layout`
- `columns`
- `min_rating`
- `show_media`
- `show_form`
- `show_product`
- `show_verified`
- `status`
- `order`
- `class`

Success criteria:

- A dedicated reviews page can be built with shortcodes.
- Product review rows can be embedded anywhere.
- Product pages can render product-specific review sections.

## Stage 3: CusRev-Style Product Form Replacement

Goal: Replace the default product review form with an Overseek form.

Plugin work:

- Add `includes/class-overseek-review-form.php`.
- Add plugin settings for enabling form replacement.
- Replace or override the default WooCommerce review form on product pages.
- Keep the final submission as a native WooCommerce product review comment.
- Respect WooCommerce review settings where practical, including moderation and verified-owner behaviour.

Form fields:

- Rating.
- Review text.
- Name.
- Email.
- Media upload.
- Optional order token context.

Success criteria:

- CusRev can be disabled and the Overseek form takes over the product page review UX.
- Submitting a review creates a native WooCommerce review.
- Pending/approved status follows configured moderation rules.

## Stage 4: Image And Video Reviews

Goal: Support review media on product pages, review pages, and email reply ingestion.

Plugin work:

- Add `includes/class-overseek-review-media.php`.
- Validate upload MIME types and sizes.
- Store accepted files as WordPress attachments.
- Link attachments to review comments using `overseek_media_ids` comment meta.
- Render media galleries on review cards.

Recommended media rules:

- Images: `jpg`, `jpeg`, `png`, `webp`, `gif`.
- Videos: `mp4`, `mov`, `webm`.
- Configurable max media count per review.
- Configurable image and video size limits.
- Default pending moderation for reviews containing media.

Success criteria:

- Customers can upload images and videos from the hosted form.
- Media displays on product review sections and review pages.
- Media remains attached to native WordPress records.

## Stage 5: Blocks

Goal: Add customizable Gutenberg/WooCommerce blocks.

Plugin work:

- Add block registrations for review page, review rows, product reviews, review form, and review summary.
- Start with server-rendered blocks so shortcodes and blocks share the same renderer.
- Add editor controls for product ID, layout, media visibility, review count, rating filter, and form visibility.

Success criteria:

- Store admins can build a reviews page using blocks.
- Blocks render consistently with shortcode output.
- Product-specific block configuration works.

## Stage 6: Plugin REST API For Reviews

Goal: Provide reliable endpoints for Overseek server management and review submission links.

Plugin work:

- Extend `OverSeek_API` or add `OverSeek_Review_API`.
- Add authenticated management endpoints.
- Add public token-protected submission endpoints.

Endpoints to add:

- `GET /wp-json/overseek/v1/reviews`
- `POST /wp-json/overseek/v1/reviews`
- `PATCH /wp-json/overseek/v1/reviews/{id}`
- `POST /wp-json/overseek/v1/reviews/{id}/reply`
- `POST /wp-json/overseek/v1/reviews/{id}/media`
- `POST /wp-json/overseek/v1/review-requests/{token}/submit`

Success criteria:

- Overseek can approve, hold, spam, trash, edit, and reply to reviews.
- Token-based customer submissions work without account login.
- Permissions prevent public moderation access.

## Stage 7: Overseek Server Review Management

Goal: Replace placeholder review management with real Woo/plugin operations.

Server work:

- Extend `server/src/services/woo.ts` with plugin review API methods.
- Replace placeholder logic in `server/src/services/ReviewService.ts`.
- Extend `server/src/routes/reviews.ts` with moderation and reply endpoints.
- Trigger targeted review sync after mutations.
- Include media metadata in synced review payloads.

Dashboard work:

- Upgrade `client/src/pages/ReviewsPage.tsx` with action controls.
- Add approve, hold, spam, trash, reply, edit, bulk action, media preview, and product/customer/order links.

Success criteria:

- Reviews can be managed from Overseek.
- Changes persist in WooCommerce.
- Synced review state reflects WooCommerce after management actions.

## Stage 8: Review Request Tokens And Email Merge Tags

Goal: Enable review request emails with one-click rating links.

Server work:

- Add review request token generation.
- Store token hash, order ID, product ID, customer email, expiry, and status.
- Generate star URLs and hosted review URLs.
- Add dedupe/cooldown so the same order/product is not repeatedly requested.

Merge tags to add:

- `{{review.requestUrl}}`
- `{{review.star1Url}}`
- `{{review.star2Url}}`
- `{{review.star3Url}}`
- `{{review.star4Url}}`
- `{{review.star5Url}}`
- `{{review.productName}}`
- `{{review.productUrl}}`
- `{{order.reviewLinks}}`

Automation work:

- Use existing `ORDER_COMPLETED` trigger for review request flows.
- Keep existing `REVIEW_LEFT` trigger for post-review flows.
- Add a standard review request recipe.

Success criteria:

- Review request emails contain one-click rating links.
- The hosted form opens with customer, product, order, and selected rating context.
- Review request sends are deduped.

## Stage 9: Reply-To-Email Reviews

Goal: Allow customers to submit review text and media by replying to the email.

Server work:

- Extend `server/src/services/EmailIngestion.ts` to detect review request replies.
- Match replies by `In-Reply-To`, `References`, `emailLog.messageId`, subject token, or hidden body token.
- Extract useful review text from the reply body.
- Attach inbound email attachments as review media.
- Submit matched replies to the Woo plugin review endpoint.
- Create a manual review item when matching is uncertain.

Email work:

- Add clear copy: customers can reply to the email with their review and attach photos/videos.
- Include a hidden token in the email body for fallback matching.

Success criteria:

- Customer replies become pending native WooCommerce reviews.
- Image/video attachments from replies are stored and linked to reviews.
- Ambiguous replies are not silently discarded.

## Stage 10: CusRev Migration And Cutover

Goal: Safely move from CusRev to Overseek reviews.

Work:

- Audit current CusRev storage on production/staging.
- Confirm which reviews already exist as native WooCommerce reviews.
- Disable CusRev form replacement.
- Enable Overseek form replacement.
- If CusRev stores media separately, add a one-time migration to WordPress attachments and `overseek_media_ids` comment meta.
- Preserve original CusRev references in `overseek_migrated_from_cusrev` comment meta.

Success criteria:

- Existing reviews remain visible.
- Existing review media remains visible or is migrated.
- WooCommerce review import/export still works.
- Product pages no longer depend on CusRev.

## Stage 11: Verification

End-to-end checks:

- Existing Woo reviews render on a reviews page.
- Existing Woo reviews render on matching product pages only.
- Custom product form creates a pending native Woo review.
- Uploaded image and video media is attached and displayed.
- Review request email star links open the hosted form with rating prefilled.
- Replying to the review email with text creates a pending review.
- Replying with image/video attachments attaches media to the review.
- Overseek can approve, hold, spam, trash, edit, and reply to a review.
- WooCommerce import/export still includes review data correctly.

## Suggested Build Order

1. Stage 1: Plugin review foundation.
2. Stage 2: Shortcodes.
3. Stage 3: Product form replacement.
4. Stage 4: Image and video reviews.
5. Stage 6: Plugin REST API.
6. Stage 7: Overseek server and dashboard management.
7. Stage 8: Review request tokens and email merge tags.
8. Stage 9: Reply-to-email reviews.
9. Stage 5: Blocks.
10. Stage 10: CusRev migration and cutover.
11. Stage 11: Verification.
