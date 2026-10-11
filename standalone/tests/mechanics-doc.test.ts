import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateLevel, SEGMENT_NAMES, STAR_KINDS, type Segment, type StarKind } from '../src/levels/generator';
import { catalogTable, switchedOff } from '../src/levels/mechanics-doc';
import { TARGETS } from '../scripts/targets';

// MECHANICS.md (repo root) is both the mechanics catalog and the switchboard the generator reads:
// these keep it in step with the code.

const md = readFileSync(new URL('../../MECHANICS.md', import.meta.url), 'utf8');
const segments = catalogTable(md, 'Segments');
const stars = catalogTable(md, 'Star challenges');

describe('MECHANICS.md', () => {
  it('lists every segment exactly once, and nothing that does not exist', () => {
    const names = segments.map((r) => r.name);
    expect([...names].sort()).toEqual([...SEGMENT_NAMES].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it('lists every star kind exactly once, and nothing that does not exist', () => {
    const names = stars.map((r) => r.name);
    expect([...names].sort()).toEqual([...STAR_KINDS].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it('says which courses use each segment, matching scripts/targets.ts', () => {
    const uses = new Map<string, Set<string>>();
    for (const t of TARGETS) {
      if (t.maze) continue;
      for (const seg of [...Object.keys(t.weights), ...(t.acts ? [...t.acts.intro, ...t.acts.twist, ...t.acts.finale] : [])]) {
        uses.set(seg, (uses.get(seg) ?? new Set()).add(t.name));
      }
    }
    const COURSES = 6; // the Courses column
    for (const row of segments) {
      const cell = row.cells[COURSES];
      if (row.name === 'fork' || row.name === 'starSpur') {
        expect(cell, row.name).toMatch(/^every /); // placed by the generator itself, on every course
        continue;
      }
      const listed = cell === '—' ? [] : cell.split(',').map((c) => c.trim());
      const expected = [...(uses.get(row.name) ?? [])];
      expect(new Set(listed), `${row.name}: expected "${expected.join(', ') || '—'}"`).toEqual(new Set(expected));
    }
  });

  it('switch cells parse, and complain clearly when mistyped', () => {
    expect(switchedOff(md).segments.every((s) => SEGMENT_NAMES.includes(s as Segment))).toBe(true);
    const typo = md.replace('| `rampUp` | on |', '| `rampUp` | nope |');
    expect(() => switchedOff(typo)).toThrow(/rampUp.*"on" or "off"/);
    const flipped = md.replace('| `rampUp` | on |', '| `rampUp` | off |').replace('| `tip` | on |', '| `tip` | off |');
    expect(switchedOff(flipped)).toMatchObject({ segments: expect.arrayContaining(['rampUp']), stars: expect.arrayContaining(['tip']) });
  });
});

describe('switched-off mechanics', () => {
  const course = (seed: number, off: { segments?: Segment[]; stars?: StarKind[] }) => {
    const placed: Segment[] = [], kinds: StarKind[] = [];
    const level = generateLevel({
      seed, name: 'T', theme: 'meadow', length: 10, stars: 3,
      weights: { bridge: 2, springUp: 2, curve: 1, straight: 1 },
      acts: { intro: ['springUp'], twist: ['boostSpring'], finale: ['springUp'] },
      off, onSegment: (s, _a, _d, k) => { placed.push(s); if (k) kinds.push(k); },
    });
    return level ? { placed, kinds } : null;
  };
  const first = (off: { segments?: Segment[]; stars?: StarKind[] }) => {
    for (let seed = 1; seed < 80; seed++) {
      const c = course(seed, off);
      if (c) return c;
    }
    throw new Error('no course in 80 seeds');
  };

  it('are never placed, even when a course asks for them (an emptied act draws from the build-up)', () => {
    const { placed } = first({ segments: ['springUp', 'boostSpring'] });
    expect(placed).not.toContain('springUp');
    expect(placed).not.toContain('boostSpring');
    expect(placed).toContain('bridge');
  });

  it('star kinds switched off are never used', () => {
    const on = first({});
    expect(on.kinds).toContain('super');
    const { kinds } = first({ stars: ['super'] });
    expect(kinds).not.toContain('super');
    expect(kinds).toHaveLength(3);
  });

  it('a course with every mechanic switched off says so', () => {
    expect(() => course(1, { segments: ['bridge', 'springUp', 'curve', 'straight'] })).toThrow(/switched off in MECHANICS.md/);
  });
});
