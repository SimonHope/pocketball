import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SIM } from '../../src/config';
import { CATALOG, DEFAULT_LOOK, ownedLook, sanitizeLook, SKUS, unlockOf, UNLOCKS, type Category, type Look } from '../../src/cosmetics';
import { findLevel, levelId } from '../../src/levels';
import type { LevelData } from '../../src/levels/schema';
import { dailyChallenges, dayKey, type GameEvent } from '../../src/meta/challenges';
import {
  AD_DOUBLES_PER_DAY, CHALLENGE_REWARD, levelFromXp, matchReward, soloReward, type Medal, type Reward,
} from '../../src/meta/progression';
import { isValidName, randomName } from '../../src/net/names';
import type { BallUpdate } from '../../src/net/protocol';
import { MoveChecker } from '../../src/net/rules';
import { resolveLevel } from '../../src/sim/geometry';
import type { Profile, SoloResult, Granted } from '../../src/meta/api';
import { Store } from './store';

// Accounts and progression. Accounts are anonymous guests: a random token (kept by the
// browser) plus a recovery code for moving to another device. No email, no passwords, no
// personal data. Only hashes of the token and recovery code are stored.

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function recoveryCode(): string {
  const bytes = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})(.{4})$/, '$1-$2-$3');

interface AccountRow { id: string; name: string; xp: number; coins: number; look: string }

export class MetaService {
  constructor(readonly store: Store = new Store(), private now: () => number = Date.now) {}

  private get db() { return this.store.db; }

  // ---------- Accounts ----------

  createGuest(name?: unknown): { token: string; recoveryCode: string; accountId: string } {
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const code = recoveryCode();
    const t = this.now();
    this.db.prepare(`INSERT INTO accounts (id, token_hash, recovery_hash, name, look, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, sha(token), sha(code), isValidName(name) ? name : randomName(), JSON.stringify(DEFAULT_LOOK), t, t);
    return { token, recoveryCode: code, accountId: id };
  }

  /** Account id for a token, or null. */
  authenticate(token: unknown): string | null {
    if (typeof token !== 'string' || token.length < 16 || token.length > 100) return null;
    const row = this.db.prepare('SELECT id FROM accounts WHERE token_hash = ?').get(sha(token)) as { id: string } | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE accounts SET last_seen = ? WHERE id = ?').run(this.now(), row.id);
    return row.id;
  }

  /** Moving to a new device: the recovery code issues a fresh token (the old one stops working). */
  restore(code: unknown): { token: string; accountId: string } | null {
    if (typeof code !== 'string') return null;
    const row = this.db.prepare('SELECT id FROM accounts WHERE recovery_hash = ?').get(sha(normalizeCode(code))) as { id: string } | undefined;
    if (!row) return null;
    const token = randomBytes(24).toString('base64url');
    this.db.prepare('UPDATE accounts SET token_hash = ?, last_seen = ? WHERE id = ?').run(sha(token), this.now(), row.id);
    return { token, accountId: row.id };
  }

  private account(id: string): AccountRow {
    const row = this.db.prepare('SELECT id, name, xp, coins, look FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
    if (!row) throw new Error('no such account');
    return row;
  }

  private bought(id: string): Set<string> {
    return new Set((this.db.prepare('SELECT item FROM bought WHERE account_id = ?').all(id) as { item: string }[]).map((r) => r.item));
  }

  profile(id: string): Profile {
    const a = this.account(id);
    const lvl = levelFromXp(a.xp);
    const bought = this.bought(id);
    const bests = Object.fromEntries((this.db.prepare('SELECT level_id, time, medal FROM best_times WHERE account_id = ?').all(id) as
      { level_id: string; time: number; medal: string | null }[]).map((r) => [r.level_id, { time: r.time, medal: r.medal as Medal | null }]));
    return {
      id: a.id,
      name: a.name,
      xp: a.xp,
      level: lvl.level,
      levelXp: lvl.into,
      levelXpNeeded: lvl.needed,
      coins: a.coins,
      bought: [...bought],
      look: ownedLook(sanitizeLook(JSON.parse(a.look)), lvl.level, bought),
      bests,
      challenges: this.challenges(id),
      adDoublesLeft: Math.max(0, AD_DOUBLES_PER_DAY - this.adDoublesToday(id)),
    };
  }

  setName(id: string, name: unknown): boolean {
    if (!isValidName(name)) return false;
    this.db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, id);
    return true;
  }

  /** Equip a look; anything not owned is swapped for the default. Returns what was equipped. */
  setLook(id: string, look: unknown): Look {
    const a = this.account(id);
    const equipped = ownedLook(sanitizeLook(look), levelFromXp(a.xp).level, this.bought(id));
    this.db.prepare('UPDATE accounts SET look = ? WHERE id = ?').run(JSON.stringify(equipped), id);
    return equipped;
  }

  /** Buy a cosmetic with coins. */
  buy(id: string, cat: unknown, index: unknown): { ok: true } | { ok: false; error: string } {
    if (typeof cat !== 'string' || !(cat in CATALOG) || typeof index !== 'number' || !CATALOG[cat as Category][index]) {
      return { ok: false, error: 'unknown item' };
    }
    const unlock = unlockOf(cat as Category, index);
    if (!('coins' in unlock)) return { ok: false, error: 'not for sale with coins' };
    const item = `${cat}:${CATALOG[cat as Category][index].id}`;
    return this.store.tx(() => {
      if (this.bought(id).has(item)) return { ok: false as const, error: 'already owned' };
      const res = this.db.prepare('UPDATE accounts SET coins = coins - ? WHERE id = ? AND coins >= ?').run(unlock.coins, id, unlock.coins);
      if (res.changes === 0) return { ok: false as const, error: 'not enough coins' };
      this.db.prepare('INSERT INTO bought (account_id, item, source, at) VALUES (?, ?, ?, ?)').run(id, item, 'coins', this.now());
      return { ok: true as const };
    });
  }

  // ---------- Rewards ----------

  /** Grants a reward once per claim id (retries and replays pay nothing). */
  private grant(id: string, claimId: string, reward: Reward): Granted | null {
    const t = this.now();
    const before = levelFromXp(this.account(id).xp).level;
    const res = this.db.prepare('INSERT OR IGNORE INTO grants (claim_id, account_id, xp, coins, day, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(claimId, id, reward.xp, reward.coins, dayKey(t), t);
    if (res.changes === 0) return null;
    this.db.prepare('UPDATE accounts SET xp = xp + ?, coins = coins + ? WHERE id = ?').run(reward.xp, reward.coins, id);
    const after = levelFromXp(this.account(id).xp).level;
    return { claimId, ...reward, levelUp: after > before ? { from: before, to: after, unlocked: levelUnlocks(before, after) } : null };
  }

  /** Daily challenges advanced by a game event; completed ones pay out. */
  private advanceChallenges(id: string, event: GameEvent): Granted[] {
    const day = dayKey(this.now());
    const out: Granted[] = [];
    for (const def of dailyChallenges(day)) {
      const n = def.count(event);
      if (!n) continue;
      this.db.prepare(`INSERT INTO challenge_progress (account_id, day, challenge, progress) VALUES (?, ?, ?, 0)
        ON CONFLICT DO NOTHING`).run(id, day, def.id);
      const row = this.db.prepare('SELECT progress, done FROM challenge_progress WHERE account_id = ? AND day = ? AND challenge = ?')
        .get(id, day, def.id) as { progress: number; done: number };
      if (row.done) continue;
      const progress = Math.min(def.target, row.progress + n);
      const done = progress >= def.target ? 1 : 0;
      this.db.prepare('UPDATE challenge_progress SET progress = ?, done = ? WHERE account_id = ? AND day = ? AND challenge = ?')
        .run(progress, done, id, day, def.id);
      if (done) {
        const g = this.grant(id, `challenge:${day}:${def.id}:${id}`, { ...CHALLENGE_REWARD, reasons: [`Challenge: ${def.label}`] });
        if (g) out.push(g);
      }
    }
    return out;
  }

  challenges(id: string): Profile['challenges'] {
    const day = dayKey(this.now());
    return dailyChallenges(day).map((def) => {
      const row = this.db.prepare('SELECT progress, done FROM challenge_progress WHERE account_id = ? AND day = ? AND challenge = ?')
        .get(id, day, def.id) as { progress: number; done: number } | undefined;
      return { id: def.id, label: def.label, target: def.target, progress: row?.progress ?? 0, done: !!row?.done };
    });
  }

  /**
   * A solo run. The server replays the recorded path through the same checks as multiplayer
   * and works out the finish time itself; only then do times reach the leaderboard.
   */
  recordSolo(id: string, levelKey: unknown, trace: unknown): SoloResult | { error: string } {
    const data = typeof levelKey === 'string' ? findLevel(levelKey) : undefined;
    if (!data || (data.kind ?? 'race') !== 'race') return { error: 'unknown course' };
    if (!Array.isArray(trace) || trace.length < 2 || trace.length > 6500) return { error: 'bad trace' };
    const level = resolveLevel(data);
    const checker = new MoveChecker(level, 0);
    let time: number | null = null;
    for (const u of trace as BallUpdate[]) {
      const r = checker.check(u, u?.t);
      if (!r.ok && r.strike) return { error: `run rejected (${r.reason})` };
      if (r.ok && r.finishTime !== undefined) { time = r.finishTime; break; }
    }
    if (time === null) return { error: 'the run never reached the goal' };
    time = Math.round((time + checker.respawns * SIM.fallPenalty) * 1000) / 1000;

    const medal = medalFor(time, data);
    const lid = levelId(data);
    const prev = this.db.prepare('SELECT time, medal FROM best_times WHERE account_id = ? AND level_id = ?').get(id, lid) as
      { time: number; medal: Medal | null } | undefined;
    const t = this.now();
    const isBest = !prev || time < prev.time;
    return this.store.tx(() => {
      // A medal depends only on the time, so the best time always carries the best medal.
      if (isBest) {
        this.db.prepare(`INSERT INTO best_times (account_id, level_id, time, medal, at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (account_id, level_id) DO UPDATE SET time = excluded.time, medal = excluded.medal, at = excluded.at`)
          .run(id, lid, time, medal, t);
      }
      const reward = soloReward({ firstFinish: !prev, medal, previousMedal: prev?.medal ?? null });
      const granted = this.grant(id, `solo:${randomUUID()}`, reward)!;
      const challenges = this.advanceChallenges(id, { type: 'solo', medal, theme: level.theme, falls: checker.respawns });
      return { time, medal, isBest, rank: this.rankOf(lid, id), granted, challenges };
    });
  }

  /** A finished multiplayer game (called by the room). Idempotent per claim id. */
  recordMatch(id: string, claimId: string, event: Extract<GameEvent, { type: 'match' }>): { granted: Granted | null; challenges: Granted[] } {
    return this.store.tx(() => {
      const granted = this.grant(id, claimId, matchReward(event));
      const challenges = granted ? this.advanceChallenges(id, event) : [];
      return { granted, challenges };
    });
  }

  private adDoublesToday(id: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM grants WHERE account_id = ? AND doubled = 1 AND day = ?').get(id, dayKey(this.now())) as { n: number };
    return row.n;
  }

  /** After a rewarded ad: pay a recent reward's coins again. Once per reward, a few per day. */
  adDouble(id: string, claimId: unknown): { ok: true; coins: number } | { ok: false; error: string } {
    if (typeof claimId !== 'string') return { ok: false, error: 'unknown reward' };
    return this.store.tx(() => {
      const g = this.db.prepare('SELECT coins, doubled, at FROM grants WHERE claim_id = ? AND account_id = ?').get(claimId, id) as
        { coins: number; doubled: number; at: number } | undefined;
      if (!g) return { ok: false as const, error: 'unknown reward' };
      if (g.doubled) return { ok: false as const, error: 'already doubled' };
      if (this.now() - g.at > 10 * 60_000) return { ok: false as const, error: 'too late' };
      if (this.adDoublesToday(id) >= AD_DOUBLES_PER_DAY) return { ok: false as const, error: 'daily limit reached' };
      this.db.prepare('UPDATE grants SET doubled = 1 WHERE claim_id = ?').run(claimId);
      this.db.prepare('UPDATE accounts SET coins = coins + ? WHERE id = ?').run(g.coins, id);
      return { ok: true as const, coins: g.coins };
    });
  }

  // ---------- Leaderboards ----------

  private rankOf(levelKey: string, id: string): number | null {
    const mine = this.db.prepare('SELECT time FROM best_times WHERE level_id = ? AND account_id = ?').get(levelKey, id) as { time: number } | undefined;
    if (!mine) return null;
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM best_times WHERE level_id = ? AND time < ?').get(levelKey, mine.time) as { n: number };
    return row.n + 1;
  }

  leaderboard(levelKey: string, id?: string | null) {
    const top = (this.db.prepare(`SELECT a.name, b.time, b.account_id FROM best_times b JOIN accounts a ON a.id = b.account_id
      WHERE b.level_id = ? ORDER BY b.time ASC, b.at ASC LIMIT 20`).all(levelKey) as { name: string; time: number; account_id: string }[])
      .map((r, i) => ({ rank: i + 1, name: r.name, time: r.time, me: r.account_id === id }));
    const mine = id ? this.db.prepare('SELECT time FROM best_times WHERE level_id = ? AND account_id = ?').get(levelKey, id) as { time: number } | undefined : undefined;
    return { top, me: mine && id ? { rank: this.rankOf(levelKey, id)!, time: mine.time } : null };
  }

  // ---------- Shop ----------

  /** Grants a real-money pack (called after the payment provider confirms). Idempotent per payment. */
  grantSku(id: string, sku: string, ref: string): boolean {
    const pack = SKUS[sku];
    if (!pack) return false;
    return this.store.tx(() => {
      const res = this.db.prepare('INSERT OR IGNORE INTO purchases (ref, account_id, sku, at) VALUES (?, ?, ?, ?)').run(ref, id, sku, this.now());
      if (res.changes === 0) return false;
      for (const item of pack.items) {
        this.db.prepare('INSERT OR IGNORE INTO bought (account_id, item, source, at) VALUES (?, ?, ?, ?)').run(id, item, ref, this.now());
      }
      return true;
    });
  }

  /**
   * "Delete my data": the account, its progress, and the browser's anonymous stats. Purchase
   * records are kept for tax law, but unlinked from the (now deleted) account.
   */
  deleteAccount(id: string | null, anonId: unknown) {
    this.store.tx(() => {
      if (id) {
        for (const table of ['bought', 'best_times', 'challenge_progress', 'grants']) {
          this.db.prepare(`DELETE FROM ${table} WHERE account_id = ?`).run(id);
        }
        this.db.prepare("UPDATE purchases SET account_id = 'deleted' WHERE account_id = ?").run(id);
        this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      }
      if (typeof anonId === 'string') this.db.prepare('DELETE FROM events WHERE anon_id = ?').run(anonId);
    });
  }

  // ---------- Analytics ----------

  logEvents(anonId: unknown, session: unknown, events: unknown): number {
    if (typeof anonId !== 'string' || typeof session !== 'string' || !Array.isArray(events)) return 0;
    const insert = this.db.prepare('INSERT INTO events (anon_id, session, name, props, t) VALUES (?, ?, ?, ?, ?)');
    let n = 0;
    this.store.tx(() => {
      for (const e of events.slice(0, 100)) {
        if (!e || typeof e.name !== 'string' || typeof e.t !== 'number') continue;
        insert.run(anonId.slice(0, 64), session.slice(0, 64), e.name.slice(0, 40), JSON.stringify(e.props ?? {}).slice(0, 2000), Math.round(e.t));
        n++;
      }
    });
    return n;
  }

  logError(message: unknown, stack: unknown, url: unknown) {
    if (typeof message !== 'string') return;
    const m = message.slice(0, 500), s = typeof stack === 'string' ? stack.slice(0, 4000) : '', u = typeof url === 'string' ? url.slice(0, 300) : '';
    const t = this.now();
    this.db.prepare(`INSERT INTO errors (hash, message, stack, url, count, first_at, last_at) VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT (hash) DO UPDATE SET count = count + 1, last_at = excluded.last_at`).run(sha(m + s.split('\n')[1]), m, s, u, t, t);
  }
}

function medalFor(time: number, level: LevelData): Medal | null {
  const m = level.medals;
  if (!m) return null;
  return time <= m.gold ? 'gold' : time <= m.silver ? 'silver' : time <= m.bronze ? 'bronze' : null;
}

/** Cosmetics that unlock at levels above `from`, up to `to`. */
function levelUnlocks(from: number, to: number): string[] {
  const out: string[] = [];
  for (const cat of Object.keys(UNLOCKS) as Category[]) {
    for (const [itemId, u] of Object.entries(UNLOCKS[cat])) if ('level' in u && u.level > from && u.level <= to) out.push(`${cat}:${itemId}`);
  }
  return out;
}
