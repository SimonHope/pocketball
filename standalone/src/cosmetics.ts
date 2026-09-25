// Cosmetic catalog: ball skins, hats, fur colors and trails. Shared by the game (drawing),
// the server (validating what players send) and, later, progression (unlocks in M4).
// Items are referenced by index, so only ever append to these lists.

export interface Skin { id: string; label: string; pattern: 'none' | 'stripes' | 'dots' | 'stars' | 'hearts' | 'checker' | 'swirl'; color: string }
export interface Hat { id: string; label: string }
export interface Fur { id: string; label: string; fur: string; belly: string }
export interface Trail { id: string; label: string; colors: string[] }

export const SKINS: Skin[] = [
  { id: 'clear', label: 'Clear', pattern: 'none', color: '#ffffff' },
  { id: 'stripes', label: 'Stripes', pattern: 'stripes', color: '#ffffff' },
  { id: 'dots', label: 'Polka dots', pattern: 'dots', color: '#ffffff' },
  { id: 'stars', label: 'Stars', pattern: 'stars', color: '#fff3a0' },
  { id: 'hearts', label: 'Hearts', pattern: 'hearts', color: '#ffb3d1' },
  { id: 'checker', label: 'Racing check', pattern: 'checker', color: '#ffffff' },
  { id: 'swirl', label: 'Swirl', pattern: 'swirl', color: '#b8f0ff' },
];

export const HATS: Hat[] = [
  { id: 'none', label: 'No hat' },
  { id: 'party', label: 'Party hat' },
  { id: 'crown', label: 'Crown' },
  { id: 'cap', label: 'Cap' },
  { id: 'bow', label: 'Bow' },
  { id: 'tophat', label: 'Top hat' },
  { id: 'halo', label: 'Halo' },
];

export const FURS: Fur[] = [
  { id: 'golden', label: 'Golden', fur: '#e0a060', belly: '#fff1dc' },
  { id: 'cream', label: 'Cream', fur: '#f3d9b1', belly: '#fffaf0' },
  { id: 'chocolate', label: 'Chocolate', fur: '#7a4a2a', belly: '#e8c9a8' },
  { id: 'grey', label: 'Grey', fur: '#9aa0a8', belly: '#eceff3' },
  { id: 'snow', label: 'Snow', fur: '#f7f7f7', belly: '#ffffff' },
  { id: 'ginger', label: 'Ginger', fur: '#e8743b', belly: '#fde2cc' },
  { id: 'midnight', label: 'Midnight', fur: '#3a3f55', belly: '#a9aec4' },
];

export const TRAILS: Trail[] = [
  { id: 'none', label: 'No trail', colors: [] },
  { id: 'sparkle', label: 'Sparkle', colors: ['#fff6a8', '#ffffff'] },
  { id: 'rainbow', label: 'Rainbow', colors: ['#ff5c5c', '#ffb14e', '#ffe45c', '#5cdb6b', '#4db5ff', '#a77bff'] },
  { id: 'bubbles', label: 'Bubbles', colors: ['#bfefff', '#e6fbff'] },
  { id: 'fire', label: 'Fire', colors: ['#ff4d1a', '#ff9a1a', '#ffd21a'] },
  { id: 'hearts', label: 'Love', colors: ['#ff6fa8', '#ffc2da'] },
];

/** A player's chosen look, as catalog indices (small numbers to sync over the network). */
export interface Look {
  skin: number;
  hat: number;
  fur: number;
  trail: number;
}

export const DEFAULT_LOOK: Look = { skin: 0, hat: 0, fur: 0, trail: 0 };

const LIMITS: Record<keyof Look, number> = { skin: SKINS.length, hat: HATS.length, fur: FURS.length, trail: TRAILS.length };

/** Clamps untrusted input (from storage or the network) to real catalog items. */
export function sanitizeLook(value: unknown): Look {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const pick = (k: keyof Look) => {
    const n = v[k];
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < LIMITS[k] ? n : DEFAULT_LOOK[k];
  };
  return { skin: pick('skin'), hat: pick('hat'), fur: pick('fur'), trail: pick('trail') };
}

// ---------- Unlocks (M4 progression) ----------
// Free, reached at a player level, bought with coins earned in play, or part of a real-money
// pack. Only cosmetics are sold, never coins or anything that affects racing.

export type Unlock = { free: true } | { level: number } | { coins: number } | { sku: string };
export type Category = keyof Look;

export const UNLOCKS: Record<Category, Record<string, Unlock>> = {
  skin: { clear: { free: true }, stripes: { level: 2 }, dots: { coins: 100 }, stars: { level: 5 }, hearts: { coins: 200 }, checker: { level: 8 }, swirl: { sku: 'starter-pack' } },
  hat: { none: { free: true }, party: { level: 3 }, crown: { level: 10 }, cap: { coins: 120 }, bow: { coins: 150 }, tophat: { coins: 300 }, halo: { sku: 'starter-pack' } },
  fur: { golden: { free: true }, cream: { free: true }, chocolate: { level: 2 }, grey: { coins: 80 }, snow: { level: 4 }, ginger: { coins: 150 }, midnight: { level: 7 } },
  trail: { none: { free: true }, sparkle: { level: 4 }, rainbow: { sku: 'starter-pack' }, bubbles: { coins: 200 }, fire: { level: 12 }, hearts: { coins: 250 } },
};

export const CATALOG: Record<Category, { id: string; label: string }[]> = { skin: SKINS, hat: HATS, fur: FURS, trail: TRAILS };

/** Real-money packs (own website only; portals and Roblox have their own stores). */
export const SKUS: Record<string, { label: string; priceCents: number; currency: string; items: string[] }> = {
  'starter-pack': { label: 'Starter Pack', priceCents: 299, currency: 'usd', items: ['skin:swirl', 'hat:halo', 'trail:rainbow'] },
};

export function itemKey(cat: Category, index: number): string {
  return `${cat}:${CATALOG[cat][index]?.id}`;
}

export function unlockOf(cat: Category, index: number): Unlock {
  return UNLOCKS[cat][CATALOG[cat][index]?.id] ?? { free: true };
}

/** Does a player with this level and these bought items own the item? */
export function owns(level: number, bought: ReadonlySet<string>, cat: Category, index: number): boolean {
  const u = unlockOf(cat, index);
  if ('free' in u) return true;
  if ('level' in u) return level >= u.level;
  return bought.has(itemKey(cat, index));
}

/** The look with anything not owned swapped for the default. */
export function ownedLook(look: Look, level: number, bought: ReadonlySet<string>): Look {
  const out = { ...look };
  for (const cat of Object.keys(CATALOG) as Category[]) if (!owns(level, bought, cat, out[cat])) out[cat] = DEFAULT_LOOK[cat];
  return out;
}
