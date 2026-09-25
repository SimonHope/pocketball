import { CATALOG, SKUS, type Category } from '../cosmetics';
import type { Granted, Leaderboard, Profile } from '../meta/api';
import { formatTime } from '../render/hud';

// Progression UI: the profile chip and daily challenges in the menu, reward summaries on
// results screens, leaderboards and the shop.

const $ = (id: string) => document.getElementById(id)!;
const el = (tag: string, className = '', text = '') => Object.assign(document.createElement(tag), { className, textContent: text });

export function renderProfile(p: Profile | null) {
  const chip = $('profile-chip');
  const challenges = $('challenges');
  if (!p) {
    chip.replaceChildren(el('span', 'hint', 'Offline — progress isn\'t being saved'));
    challenges.replaceChildren();
    return;
  }
  const bar = el('div', 'xpbar');
  const fill = el('div');
  fill.style.width = `${Math.round((p.levelXp / p.levelXpNeeded) * 100)}%`;
  bar.append(fill);
  bar.title = `${p.levelXp} / ${p.levelXpNeeded} XP`;
  chip.replaceChildren(el('span', 'lvl', `Lv ${p.level}`), bar, el('span', '', `🪙 ${p.coins}`));
  challenges.replaceChildren(
    el('div', 'hint', 'Today\'s challenges (🪙 40 + 30 XP each)'),
    ...p.challenges.map((c) => {
      const row = el('div', `c${c.done ? ' done' : ''}`);
      row.append(el('span', '', `${c.done ? '✓ ' : ''}${c.label}`), el('span', '', `${c.progress}/${c.target}`));
      return row;
    }),
  );
}

/** Pretty name for an item key like 'hat:party'. */
export function itemName(key: string): string {
  const [cat, id] = key.split(':') as [Category, string];
  return CATALOG[cat]?.find((i) => i.id === id)?.label ?? key;
}

/** "+45 XP · +23 🪙", reasons, level-ups and finished challenges. */
export function renderRewards(target: HTMLElement, grants: Granted[], note = '') {
  target.replaceChildren();
  if (note) target.append(el('div', 'hint', note));
  const total = grants.reduce((a, g) => ({ xp: a.xp + g.xp, coins: a.coins + g.coins }), { xp: 0, coins: 0 });
  if (!grants.length) return;
  target.append(el('div', 'big', `+${total.xp} XP · +${total.coins} 🪙`));
  for (const g of grants) {
    target.append(el('div', 'hint', g.reasons.join(' · ')));
    if (g.levelUp) {
      const unlocked = g.levelUp.unlocked.map(itemName);
      target.append(el('div', 'lvlup', `Level up! Lv ${g.levelUp.to}${unlocked.length ? ` — unlocked ${unlocked.join(', ')}` : ''}`));
    }
  }
}

export function renderLeaderboard(title: string, board: Leaderboard | null) {
  $('board-title').textContent = `🏆 ${title}`;
  const list = $('board-list');
  if (!board) {
    list.replaceChildren(el('span', 'hint', 'Leaderboards need a connection.'));
    $('board-me').textContent = '';
    return;
  }
  list.replaceChildren(...(board.top.length ? board.top.flatMap((e) => [
    el('span', e.me ? 'me' : '', `${e.rank}.`),
    el('span', e.me ? 'me' : '', e.name),
    el('span', e.me ? 'me' : '', formatTime(e.time)),
  ]) : [el('span', 'hint', 'No times yet — be the first!')]));
  $('board-me').textContent = board.me && !board.top.some((e) => e.me) ? `You: #${board.me.rank} · ${formatTime(board.me.time)}` : '';
}

export function renderShop(owned: Set<string>, onBuy: (sku: string) => void) {
  $('shop-error').textContent = '';
  $('shop-packs').replaceChildren(...Object.entries(SKUS).map(([sku, pack]) => {
    const card = el('div', 'pack');
    const have = pack.items.every((i) => owned.has(i));
    const buy = el('button', 'primary', have ? 'Owned ✓' : 'Buy') as HTMLButtonElement;
    buy.disabled = have;
    buy.addEventListener('click', () => onBuy(sku));
    card.append(
      el('div', '', pack.label),
      el('div', 'hint', pack.items.map(itemName).join(' · ')),
      el('div', 'price', `$${(pack.priceCents / 100).toFixed(2)}`),
      buy,
    );
    return card;
  }));
}
