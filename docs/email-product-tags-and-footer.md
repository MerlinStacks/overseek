# Product tag conditions and footer media

In a flow condition, choose **WooCommerce** and either:

- **Order contains product with tag** to check the flow's order (or the latest purchase when the flow has no order reference).
- **Customer purchased product with tag** to check the customer's purchase history, not just their latest order.

Search the tag picker for a WooCommerce product tag such as `9ct`, then select it. Search and pagination use the selected account's live WooCommerce taxonomy. Rules store the tag ID and use exact membership, not partial text matching. Both conditions support “contains” and “does not contain.”

Purchase history includes processing, on-hold and completed orders, matching the existing purchase-history policy. Product membership uses current synced WooCommerce product tags, including the parent product for variations. It is not a snapshot of tags at the time of purchase. Missing or unsynced products cannot positively match a tag.

In **Settings > Email > Account Email Footer**, use **Add image** to upload an email asset or enter a public HTTPS URL, alternative text and display width. Uploads support PNG, JPG, GIF and WebP up to 5MB, using the email designer's existing asset endpoint. Use **Add social links** to insert platform icons and profile URLs; saved account social links prefill the form. Unused URLs can be left blank. Images can be removed within the editor, and links remain editable using the link toolbar.

Save the footer as before. Keep `{{unsubscribe_url}}` in marketing footers. Image and icon content is retained in both the designer preview and compiled emails. Existing email drafts retain their saved footer until their brand defaults are explicitly refreshed.
