import { CATALOG, FURS, TRAILS, unlockOf, type Category, type Look } from '../cosmetics';

// The Customize screen: one row of choices per cosmetic category. Locked items show what
// unlocks them (a level, a coin price, or a shop pack); clicking one asks `onLocked`.

export interface Ownership {
  owns(cat: Category, index: number): boolean;
  onLocked(cat: Category, index: number): void;
}

const SWATCH: Partial<Record<Category, (i: number) => string | undefined>> = {
  fur: (i) => FURS[i].fur,
  trail: (i) => TRAILS[i].colors[0],
};

function requirement(cat: Category, index: number): string {
  const u = unlockOf(cat, index);
  if ('level' in u) return `Lv ${u.level}`;
  if ('coins' in u) return `🪙 ${u.coins}`;
  if ('sku' in u) return 'Shop';
  return '';
}

export function renderCustomize(look: Look, onChange: (look: Look) => void, own: Ownership) {
  for (const cat of Object.keys(CATALOG) as Category[]) {
    const row = document.getElementById(`choose-${cat}`)!;
    row.replaceChildren(...CATALOG[cat].map((item, i) => {
      const b = document.createElement('button');
      const owned = own.owns(cat, i);
      b.classList.toggle('sel', look[cat] === i);
      b.classList.toggle('locked', !owned);
      const swatch = SWATCH[cat]?.(i);
      if (swatch) {
        const dot = document.createElement('span');
        dot.className = 'swatch';
        dot.style.background = swatch;
        b.append(dot);
      }
      b.append(item.label);
      if (!owned) {
        const req = document.createElement('span');
        req.className = 'req';
        req.textContent = `🔒 ${requirement(cat, i)}`;
        b.append(req);
      }
      b.addEventListener('click', () => {
        if (!own.owns(cat, i)) return own.onLocked(cat, i);
        const next = { ...look, [cat]: i };
        onChange(next);
        renderCustomize(next, onChange, own);
        (document.getElementById(`choose-${cat}`)!.children[i] as HTMLElement).focus();
      });
      return b;
    }));
  }
}
