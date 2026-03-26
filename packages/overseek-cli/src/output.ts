/**
 * Output formatting for CLI results.
 * Supports --json flag for machine-readable output, otherwise prints human-friendly tables.
 */

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log('No results.');
    return;
  }

  const cols = columns ?? Object.keys(rows[0]);

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = col.length;
    for (const row of rows) {
      const val = formatCell(row[col]);
      widths[col] = Math.max(widths[col], val.length);
    }
  }

  // Header
  const header = cols.map((c) => c.padEnd(widths[c])).join('  ');
  const divider = cols.map((c) => '─'.repeat(widths[c])).join('──');
  console.log(header);
  console.log(divider);

  // Rows
  for (const row of rows) {
    const line = cols.map((c) => formatCell(row[c]).padEnd(widths[c])).join('  ');
    console.log(line);
  }

  console.log(`\n${rows.length} result(s)`);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.join(', ');
  return String(value).slice(0, 60);
}

export function printSummary(label: string, data: Record<string, unknown>): void {
  console.log(`\n  ${label}`);
  console.log('  ' + '─'.repeat(40));
  for (const [key, value] of Object.entries(data)) {
    console.log(`  ${key.padEnd(20)} ${formatCell(value)}`);
  }
  console.log();
}
