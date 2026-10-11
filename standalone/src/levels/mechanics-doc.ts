// Reads MECHANICS.md (the mechanics catalog at the repo root): which segments and star kinds are
// switched on, and which courses the catalog says use each segment. The generator obeys the
// switches (scripts/generate-levels.ts passes them in), and tests/mechanics-doc.test.ts keeps the
// catalog and the code in step.

export interface CatalogRow {
  name: string;
  on: boolean;
  /** Every cell, as written (the first is the name, the second On). */
  cells: string[];
}

/** The rows of the first table under the heading `## <title>` (names are written in backticks). */
export function catalogTable(md: string, title: string): CatalogRow[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${title.toLowerCase()}`);
  if (start < 0) throw new Error(`MECHANICS.md has no "## ${title}" section`);
  const rows: CatalogRow[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const name = /^`([^`]+)`$/.exec(cells[0])?.[1];
    if (!name) continue; // the header row and the |---| line
    const on = cells[1]?.toLowerCase();
    if (on !== 'on' && on !== 'off') throw new Error(`MECHANICS.md: "${name}" must be "on" or "off" in the On column, not "${cells[1]}"`);
    rows.push({ name, on: on === 'on', cells });
  }
  return rows;
}

/** What MECHANICS.md switches off. */
export function switchedOff(md: string): { segments: string[]; stars: string[] } {
  return {
    segments: catalogTable(md, 'Segments').filter((r) => !r.on).map((r) => r.name),
    stars: catalogTable(md, 'Star challenges').filter((r) => !r.on).map((r) => r.name),
  };
}
