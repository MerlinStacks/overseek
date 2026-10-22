interface GroupableFeedRow {
    wooId: number;
    rowType: string;
}

/** Keep the API's product order; group editors are never exported or selected as variants. */
export function visibleFeedRows<T extends GroupableFeedRow>(rows: T[], groups: T[], expanded: Record<number, boolean>): T[] {
    const parents = new Map(groups.map((group) => [group.wooId, group]));
    const seen = new Set<number>();
    return rows.flatMap((row) => {
        const parent = parents.get(row.wooId);
        if (!parent) return [row];
        const first = !seen.has(row.wooId);
        seen.add(row.wooId);
        return [...(first ? [parent] : []), ...(expanded[row.wooId] ? [row] : [])];
    });
}
