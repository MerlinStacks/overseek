/** Only expose known error categories; provider errors can contain credentials/URLs. */
export function describeBOMFailure(error: unknown): string {
    const text = typeof error === 'string' ? error.toLowerCase() : '';
    if (/inventory management permission/.test(text)) return 'The user who requested repair no longer has inventory management permission. An authorized administrator must start a new repair.';
    if (/bom_repair_definition_changed/.test(text)) return 'BOM definitions changed during repair. Keep definitions stable and start a fresh repair.';
    if (/bom_repair_changed|source jobs changed/.test(text)) return 'The previous execution changed or new work appeared. Refresh run details and verify that old writes have stopped before repairing again.';
    if (/initialized repair|must not be replayed/.test(text)) return 'This repair attempt cannot be replayed. Use Repair & resume to check fresh stock in a new attempt.';
    if (/prisma|database|db down/.test(text)) return 'A database or audit update failed. Check database health before repairing again; an earlier WooCommerce stock write may already have completed.';
    if (/\block\b|\blease\b|\bstall(?:ed|ing)?\b/.test(text)) return 'The worker stalled or lost its job lock. An in-flight stock write may not have been acknowledged.';
    if (/\b(?:401|403)\b|authentication|permission|unauthorized|woocommerce_rest_cannot_edit/.test(text)) return 'WooCommerce rejected access. Check the store connection and API key read/write permissions.';
    if (/429|rate.limit/.test(text)) return 'WooCommerce rate-limited the request. Review the store API limits before retrying.';
    if (/timeout|timed.out|etimedout|econn|network|eai_again/.test(text)) return 'A store or database connection failed or timed out. Check connectivity and whether any stock request completed.';
    if (/invalid.id|not.found|not be found|deleted|missing/.test(text)) return 'A product or variation could not be found. Check its WooCommerce mapping and BOM components.';
    if (/uncertain products|one or more products failed/.test(text)) return 'One or more products failed during the run. Their stock writes need verification before another bulk sync.';
    return 'No safely displayable cause was retained. Ask an administrator to inspect worker logs using the run ID and time shown here.';
}
