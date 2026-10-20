# Storefront review badges

The twelve WebP badges are cropped from the user-supplied `source.png`. Only the
exterior and interior cream backing is removed. Lettering, metallic borders,
and ribbon lettering are retained. Each asset is 480 × 480, including
transparent padding, and renders at 132 × 132 CSS pixels.

Regenerate from the repository root:

```sh
uv run --with pillow python scripts/crop-review-badges.py
```

Verified-review awards use the highest earned threshold from the supplied artwork:
5, 25, 500, 750, 1000, 1500, 3000 and 5000. Larger counts retain the 5000+ badge.

Transparency eligibility: Bronze at 30%, Silver at 60%, Gold at 90%, and Platinum
at 95% of active reviews published. Eligibility uses the unrounded percentage.
Existing SVGs are retained as legacy assets.

Badge images retain accessible labels and descriptive hover text. They do not
change review counts or contribute to product rating calculations.
