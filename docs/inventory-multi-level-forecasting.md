# Multi-level inventory forecasting

Inventory forecasts now accept acyclic, multi-level BOMs instead of rejecting
every assembly that is itself a component. This is a read-only planning change;
there are no migrations, stock deductions, BOM rewrites or plugin updates.

## Demand calculation

- Read the account-scoped BOM graph and trace ancestors of requested inventory.
- Multiply `quantity * (1 + wasteFactor)` at every level.
- Sum coefficients across all paths from a sale source to a component. Shared
  subassemblies and duplicate recipe lines accumulate required units, but each
  source's sales history is read/countable once per component.
- Add demand from direct sales of intermediate assemblies as well as their
  ancestors. A forecast row's own direct sales remain in its existing prediction,
  not in its derived-demand value a second time.
- Keep variant recipes distinct. An explicit variant BOM overrides the default,
  including an explicitly empty override. Other variants inherit the default
  recipe. Default-parent historical sales exclude variant-specific overrides.
- Keep internal products and managed component variations distinct from parent
  products and sibling variations. Supplier catalogue lines remain cost-only.

This is **gross replenishment demand**, using the existing 90-day BOM sales
window. It is not an assembly production scheduler or net material-requirements
planner: intermediate stock is not netted against future assembly production.
Existing on-hand/inbound calculations still apply to each forecasted inventory
row. Stock consumption continues treating child BOMs as stocked assemblies;
planning does not introduce phantom-assembly recursive deductions.

## Failures and limits

Only cycles reachable through the requested components' ancestry block their
planning; disconnected cycles do not. A real cycle returns HTTP 409 with code
`BOM_CYCLE_DETECTED`. List, alert and detail routes preserve this error rather
than turning it into empty data or a missing product. The UI explains how to
check self-references and indirect cycles, without describing valid nesting as
unsupported.

Missing/foreign/inactive references, invalid quantities/waste, incomplete sales
history, overflow and coverage truncation still fail closed. The account graph
read is bounded to 10,000 BOM item rows; sparse transitive contributions are
bounded to 100,000. Oversized graphs are rejected, not partially forecast.
Traversal is iterative and does not enumerate every path or query once per SKU.

## Deployment and regression coverage

Deploy the updated API and client. An older server can still emit the previous
multi-level-planning error; the new client explains that the server needs an
update. No existing inventory data needs resetting or deleting.

Tests cover multiplied waste, shared/duplicate paths, intermediate sales,
internal components, variant overrides/fallback, empty overrides, genuine and
disconnected cycles, deep chains, overflow and bounds. Generated acyclic graphs
are compared with an independent path-summing oracle. A service-level regression
checks the final forecast includes both direct prediction and nested demand
while leaving stock unchanged.
