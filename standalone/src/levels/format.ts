import type { LevelData } from './schema';

// Serializes a level the way the hand-written files look: one piece / waypoint per line,
// so diffs of level changes stay readable in code review.

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value && typeof value === 'object') {
    const parts = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
    return `{ ${parts.join(', ')} }`;
  }
  return JSON.stringify(value);
}

export function formatLevel(level: LevelData): string {
  const lines = Object.entries(level)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => {
      if ((key === 'pieces' || key === 'route') && Array.isArray(value)) {
        const items = value.map((item) => `    ${inline(item)}`).join(',\n');
        return `  ${JSON.stringify(key)}: [\n${items}\n  ]`;
      }
      return `  ${JSON.stringify(key)}: ${inline(value)}`;
    });
  return `{\n${lines.join(',\n')}\n}\n`;
}
