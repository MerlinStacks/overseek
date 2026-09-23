# Native WooCommerce COGS export

Overseek owns the local `WooProduct.cogs` and `ProductVariation.cogs` columns.
Explicit cost saves export to WooCommerce `wc/v3` products/variations using:

```json
{ "cost_of_goods_sold": { "values": [{ "defined_value": 12.5 }] } }
```

Variation exports also set `defined_value_is_additive: false`: the local cost is
the final variation cost, not an amount to add to its parent's cost. Explicit
zero is exported, including variation COGS-only edits. No third-party metadata
keys are written. Miscellaneous costs are not added to the COGS field.

## Triggers and absence

- Product/variation edits supplying a finite non-negative COGS value export it.
- Saving a nonempty BOM exports its calculated COGS, including zero.
- Omitted, null or blank costs never cause an outbound zero/reset. Existing local
  clearing semantics remain: direct service null/blank edits and BOM removal can
  clear the local cost without clearing Woo's cost; the parent PATCH API treats
  blank input as omitted. Use explicit `0` to set Woo's cost to zero.
- Inbound product/variation sync never imports remote costs into local COGS,
  even on first import. Remote snapshots may retain them in `rawData`.

## Deployment and limitations

WooCommerce must support the native REST COGS field and have its native COGS
feature enabled. Disabled/older stores may ignore the field; this implementation
does not probe capabilities or verify acknowledgement. Transport errors are
logged and local saves remain authoritative, using the existing best-effort
product sync behavior. There is no durable COGS retry queue; resave to retry.

Existing costs require an explicit cost resave (or nonempty BOM resave), or a
separately planned backfill. Deployment and inbound catalogue sync do not push
existing costs. No backfill or live Woo writes were performed for this change.
Editing Woo's cost does not change Overseek's value; a subsequent explicit
Overseek cost save replaces it. There is no continuous remote drift repair.
Changes to BOM component costs do not automatically recalculate/export dependent
BOM costs; those BOMs must be saved again. Historical order costs are untouched.

## Upstream contract checked

- [CogsAwareRestControllerTrait](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/src/Internal/CostOfGoodsSold/CogsAwareRestControllerTrait.php)
  defines the writable numeric `values[].defined_value` and variation additive flag.
- [WC_Product_Variation](https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/class-wc-product-variation.php)
  preserves explicit zero as an override; null inherits the parent cost.
- The products controller gates COGS writes on `cogs_is_enabled()`.
