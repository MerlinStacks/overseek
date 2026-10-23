# Workspace UI conventions

The workspace should feel like a focused business tool, not a collection of promotional landing pages.

## Brand identity

- Account appearance settings are the source for the business name, logo and primary colour.
- Use `--primary-color` with `--primary-foreground` for filled primary actions. Never assume white text is readable on the configured colour.
- Use `--brand-subtle`, `--brand-border` and `--brand-text` for selected controls, links and quiet highlights. These aliases adapt to light and dark mode.
- Use `--primary-hover` for filled-action hover states and `--focus-color` for focus indicators. Brightness filters can break text contrast; the raw primary colour can disappear against a matching surface.
- Do not redefine generic Tailwind blue, indigo or purple scales to implement branding. Statuses, channels, chart series and customer-created document designs have independent meanings.
- Theme ownership must clean up on account changes, logout and unmount. Never persist a previous account's appearance as the next account's default.

## Presentation

- Summary metrics should be slim shared strips or inline counters, not rows of separate padded cards. Use `MetricStrip` / `Metric` for read-only summaries; preserve real button semantics for filters. Keep supporting labels and unknown-value context visible. Aim for roughly 60–72px on wide screens, allowing wrapping rather than fixing height or clipping text. Actual charts, forms and detail panels still need their own structure.
- Prefer opaque neutral surfaces, clear borders and restrained shadows. Avoid decorative gradients, glowing buttons, mesh backgrounds, floating cards and entrance-animation sequences.
- Keep the main action obvious. Secondary actions use neutral borders or text; destructive actions retain warning colours and confirmation behaviour.
- Use the shared `workspaceStyles` for forms, tables, controls and read panels; use shared UI primitives instead of introducing another card or tab treatment.
- Keep headings concise and sentence case. Show useful information before explanatory notes; secondary methodology can use `DataNote`, but errors and action warnings must remain visible.
- Tables scroll within their own containers. Toolbars wrap, content columns can shrink, and mobile controls must remain reachable.
- Give icon-only controls accessible names. Selected state needs an accessible attribute or text, not colour alone. Honour reduced-motion preferences.

## Review

Check representative routes at narrow and wide widths in light and dark mode, with a dark brand, a bright brand, no saved branding, and an account switch. Verify loading, empty, filtered-empty, failed-read and disabled states, not only populated screenshots. Automated tests and a production build complement this review; they do not replace it.
