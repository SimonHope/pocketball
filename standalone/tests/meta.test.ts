import { beforeAll, describe, expect, it } from 'vitest';
import { MetaService } from '../server/meta/service';
import { Store } from '../server/meta/store';
import { HATS, itemKey, SKINS, SKUS } from '../src/cosmetics';
import { LEVELS, levelId } from '../src/levels';
import { dailyChallenges, dayKey } from '../src/meta/challenges';
import { AD_DOUBLES_PER_DAY, levelFromXp, matchReward, soloReward } from '../src/meta/progression';
import { autopilotTrace } from './helpers';

const DAY = Date.UTC(2026, 8, 24, 12);
let clock = DAY;
const fresh = () => new MetaService(new Store(':memory:'), () => clock);

type Trace = Awaited<ReturnType<typeof autopilotTrace>>;
let warmUp: Trace, warmUpWithFall: Trace;
beforeAll(async () => {
  warmUp = await autopilotTrace(LEVELS[0]);
  warmUpWithFall = await autopilotTrace(LEVELS[0], 0, { fallAfter: 5 });
});

describe('progression rules', () => {
  it('level curve: 100 XP for level 2, then +50 more per level', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, needed: 100 });
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100)).toEqual({ level: 2, into: 0, needed: 150 });
    expect(levelFromXp(250).level).toBe(3);
  });

  it('medal bonuses pay once per tier', () => {
    const first = soloReward({ firstFinish: true, medal: 'silver', previousMedal: null });
    expect(first.reasons).toEqual(['Finished', 'First finish on this course', 'New bronze medal', 'New silver medal']);
    const again = soloReward({ firstFinish: false, medal: 'silver', previousMedal: 'silver' });
    expect(again.xp).toBe(5);
    const upgrade = soloReward({ firstFinish: false, medal: 'gold', previousMedal: 'silver' });
    expect(upgrade.reasons).toEqual(['Finished', 'New gold medal']);
  });

  it('match rewards grow with players beaten, and winning pays extra', () => {
    expect(matchReward({ mode: 'race', place: 1, players: 8 }).xp).toBeGreaterThan(matchReward({ mode: 'race', place: 2, players: 8 }).xp);
    expect(matchReward({ mode: 'race', place: 1, players: 1 }).reasons).not.toContain('Win!'); // solo room: no win bonus
  });

  it('daily challenges: 3 different ones, the same for everyone on a day', () => {
    const today = dailyChallenges('2026-09-24');
    expect(new Set(today.map((c) => c.id)).size).toBe(3);
    expect(dailyChallenges('2026-09-24').map((c) => c.id)).toEqual(today.map((c) => c.id));
  });
});

describe('accounts', () => {
  it('guest accounts: token signs in; recovery code moves to a new device', () => {
    const m = fresh();
    const g = m.createGuest('Zippy Hammy');
    expect(m.authenticate(g.token)).toBe(g.accountId);
    expect(m.authenticate('x'.repeat(32))).toBeNull();
    expect(m.profile(g.accountId)).toMatchObject({ name: 'Zippy Hammy', level: 1, coins: 0, xp: 0 });

    const moved = m.restore(g.recoveryCode.toLowerCase().replaceAll('-', ' '))!; // typed sloppily
    expect(moved.accountId).toBe(g.accountId);
    expect(m.authenticate(moved.token)).toBe(g.accountId);
    expect(m.authenticate(g.token)).toBeNull(); // the old device is signed out
    expect(m.restore('AAAA-BBBB-CCCC')).toBeNull();
  });

  it('names must be generated ones', () => {
    const m = fresh();
    const g = m.createGuest('I am typed');
    expect(m.profile(g.accountId).name).not.toBe('I am typed');
    expect(m.setName(g.accountId, 'rude word')).toBe(false);
    expect(m.setName(g.accountId, 'Brave Mochi')).toBe(true);
  });
});

describe('solo runs', () => {
  it('replays an honest run, works out the time, pays rewards, ranks it', () => {
    const m = fresh();
    const g = m.createGuest();
    const r = m.recordSolo(g.accountId, levelId(LEVELS[0]), warmUp.updates);
    if ('error' in r) throw new Error(r.error);
    expect(r.time).toBeCloseTo(warmUp.time, 1);
    expect(r.isBest).toBe(true);
    expect(r.rank).toBe(1);
    expect(r.granted.reasons).toContain('First finish on this course');
    const p = m.profile(g.accountId);
    expect(p.bests[levelId(LEVELS[0])].time).toBe(r.time);
    expect(p.xp).toBeGreaterThanOrEqual(r.granted.xp);
  });

  it('a fall costs the same 2 s penalty the game shows', () => {
    const m = fresh();
    const g = m.createGuest();
    const r = m.recordSolo(g.accountId, levelId(LEVELS[0]), warmUpWithFall.updates);
    if ('error' in r) throw new Error(r.error);
    expect(r.time).toBeCloseTo(warmUpWithFall.time, 1); // sim time already includes the penalty
    expect(r.time).toBeGreaterThan(warmUp.time + 1.5); // +2 s penalty, minus the little ground lost
  });

  it('rejects cheated runs and runs that never finish', () => {
    const m = fresh();
    const g = m.createGuest();
    const cheat = [...warmUp.updates.slice(0, 20), { t: warmUp.updates[19].t + 50, p: [32, 0, -135], v: [0, 0, 0] }];
    expect(m.recordSolo(g.accountId, levelId(LEVELS[0]), cheat)).toMatchObject({ error: expect.stringContaining('rejected') });
    expect(m.recordSolo(g.accountId, levelId(LEVELS[0]), warmUp.updates.slice(0, 50))).toMatchObject({ error: expect.stringContaining('never reached') });
    expect(m.recordSolo(g.accountId, 'no-such-course', warmUp.updates)).toMatchObject({ error: 'unknown course' });
  });

  it('leaderboard: best time per player, slower reruns do not count', () => {
    const m = fresh();
    const a = m.createGuest('Zippy Hammy'), b = m.createGuest('Tiny Bean');
    const lid = levelId(LEVELS[0]);
    m.recordSolo(b.accountId, lid, warmUpWithFall.updates); // slower
    m.recordSolo(a.accountId, lid, warmUp.updates);
    const again = m.recordSolo(a.accountId, lid, warmUpWithFall.updates);
    if ('error' in again) throw new Error(again.error);
    expect(again.isBest).toBe(false);
    const board = m.leaderboard(lid, b.accountId);
    expect(board.top.map((e) => e.name)).toEqual(['Zippy Hammy', 'Tiny Bean']);
    expect(board.me).toMatchObject({ rank: 2 });
  });
});

describe('unlocks and spending', () => {
  it('buying with coins; equipping only what you own', () => {
    const m = fresh();
    const g = m.createGuest();
    const cap = HATS.findIndex((h) => h.id === 'cap');
    expect(m.buy(g.accountId, 'hat', cap)).toEqual({ ok: false, error: 'not enough coins' });
    for (let i = 0; i < 10; i++) m.recordMatch(g.accountId, `match-${i}`, { type: 'match', mode: 'race', quick: true, place: 1, players: 8, finished: true, survived: true, reachedFinal: true });
    const coins = m.profile(g.accountId).coins;
    expect(m.buy(g.accountId, 'hat', cap)).toEqual({ ok: true });
    expect(m.profile(g.accountId).coins).toBe(coins - 120);
    expect(m.buy(g.accountId, 'hat', cap)).toEqual({ ok: false, error: 'already owned' });
    expect(m.setLook(g.accountId, { skin: 0, hat: cap, fur: 0, trail: 0 }).hat).toBe(cap);
    const halo = HATS.findIndex((h) => h.id === 'halo'); // real-money only
    expect(m.buy(g.accountId, 'hat', halo)).toEqual({ ok: false, error: 'not for sale with coins' });
    expect(m.setLook(g.accountId, { skin: 0, hat: halo, fur: 0, trail: 0 }).hat).toBe(0);
  });

  it('level-up unlocks are reported and become equippable', () => {
    const m = fresh();
    const g = m.createGuest();
    const party = HATS.findIndex((h) => h.id === 'party'); // level 3
    expect(m.setLook(g.accountId, { skin: 0, hat: party, fur: 0, trail: 0 }).hat).toBe(0);
    let unlocked: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = m.recordMatch(g.accountId, `m${i}`, { type: 'match', mode: 'race', quick: false, place: 1, players: 8, finished: true, survived: true, reachedFinal: true });
      unlocked = unlocked.concat(r.granted?.levelUp?.unlocked ?? []);
    }
    expect(m.profile(g.accountId).level).toBeGreaterThanOrEqual(3);
    expect(unlocked).toContain('hat:party');
    expect(m.setLook(g.accountId, { skin: 0, hat: party, fur: 0, trail: 0 }).hat).toBe(party);
  });

  it('match rewards are paid once per claim', () => {
    const m = fresh();
    const g = m.createGuest();
    const ev = { type: 'match' as const, mode: 'race' as const, quick: true, place: 2, players: 4, finished: true, survived: true, reachedFinal: false };
    expect(m.recordMatch(g.accountId, 'room:1', ev).granted).not.toBeNull();
    expect(m.recordMatch(g.accountId, 'room:1', ev).granted).toBeNull();
  });

  it('ad double: once per reward, within 10 minutes, capped per day', () => {
    const m = fresh();
    const g = m.createGuest();
    const ev = { type: 'match' as const, mode: 'race' as const, quick: true, place: 1, players: 4, finished: true, survived: true, reachedFinal: false };
    const claims = Array.from({ length: AD_DOUBLES_PER_DAY + 2 }, (_, i) => m.recordMatch(g.accountId, `c${i}`, ev).granted!.claimId);
    const first = m.adDouble(g.accountId, claims[0]);
    expect(first.ok).toBe(true);
    expect(m.adDouble(g.accountId, claims[0])).toEqual({ ok: false, error: 'already doubled' });
    for (let i = 1; i < AD_DOUBLES_PER_DAY; i++) expect(m.adDouble(g.accountId, claims[i]).ok).toBe(true);
    expect(m.adDouble(g.accountId, claims[AD_DOUBLES_PER_DAY])).toEqual({ ok: false, error: 'daily limit reached' });
    expect(m.profile(g.accountId).adDoublesLeft).toBe(0);
    clock += 11 * 60_000;
    expect(m.adDouble(g.accountId, claims[AD_DOUBLES_PER_DAY + 1])).toMatchObject({ ok: false });
    clock = DAY;
  });

  it('real-money packs grant their items once per payment', () => {
    const m = fresh();
    const g = m.createGuest();
    expect(m.grantSku(g.accountId, 'starter-pack', 'cs_test_1')).toBe(true);
    expect(m.grantSku(g.accountId, 'starter-pack', 'cs_test_1')).toBe(false); // webhook retried
    expect(new Set(m.profile(g.accountId).bought)).toEqual(new Set(SKUS['starter-pack'].items));
    expect(m.profile(g.accountId).bought).toContain(itemKey('skin', SKINS.findIndex((s) => s.id === 'swirl')));
  });
});

describe('daily challenges', () => {
  it('progress, completion pays once, resets the next day', () => {
    const m = fresh();
    const g = m.createGuest();
    const ids = dailyChallenges(dayKey(clock)).map((c) => c.id);
    // Play plenty of everything.
    const events = [
      { type: 'match' as const, mode: 'race' as const, quick: true, place: 1, players: 8, finished: true, survived: true, reachedFinal: true },
      { type: 'match' as const, mode: 'hill' as const, quick: true, place: 1, players: 8, finished: false, survived: true, reachedFinal: false },
      { type: 'match' as const, mode: 'arena' as const, quick: true, place: 1, players: 8, finished: false, survived: true, reachedFinal: false },
      { type: 'match' as const, mode: 'elimination' as const, quick: true, place: 1, players: 8, finished: true, survived: true, reachedFinal: true },
    ];
    let paid = 0;
    for (let i = 0; i < 4; i++) for (const [j, e] of events.entries()) paid += m.recordMatch(g.accountId, `x${i}${j}`, e).challenges.length;
    const solo = m.recordSolo(g.accountId, levelId(LEVELS[0]), warmUp.updates);
    if (!('error' in solo)) paid += solo.challenges.length;
    const today = m.profile(g.accountId).challenges;
    expect(today.map((c) => c.id)).toEqual(ids);
    expect(paid).toBe(today.filter((c) => c.done).length);
    clock += 24 * 3600_000;
    expect(m.profile(g.accountId).challenges.every((c) => c.progress === 0)).toBe(true);
    clock = DAY;
  });
});

describe('analytics', () => {
  it('stores events and groups repeated errors', () => {
    const m = fresh();
    expect(m.logEvents('anon-1', 's1', [{ name: 'session_start', t: clock }, { name: 'level_start', t: clock, props: { level: 'warm-up' } }, { bad: 1 }])).toBe(2);
    m.logError('Boom', 'Error: Boom\n    at a.js:1', '/');
    m.logError('Boom', 'Error: Boom\n    at a.js:1', '/');
    const row = m.store.db.prepare('SELECT count FROM errors').get() as { count: number };
    expect(row.count).toBe(2);
  });
});

describe('analytics report', () => {
  it('retention, session length and course funnel', async () => {
    const { computeReport } = await import('../server/meta/report');
    const m = fresh();
    const D = 86_400_000, t0 = Date.UTC(2026, 8, 1);
    // Player A: plays day 0, day 1 and day 7. Player B: day 0 only.
    m.logEvents('A', 'a1', [{ name: 'session_start', t: t0 }, { name: 'level_start', t: t0 + 1000, props: { level: 'warm-up' } }, { name: 'level_finish', t: t0 + 61_000, props: { level: 'warm-up' } }]);
    m.logEvents('A', 'a2', [{ name: 'session_start', t: t0 + D }]);
    m.logEvents('A', 'a3', [{ name: 'session_start', t: t0 + 7 * D }]);
    m.logEvents('B', 'b1', [{ name: 'session_start', t: t0 }, { name: 'level_start', t: t0 + 5000, props: { level: 'warm-up' } }, { name: 'level_quit', t: t0 + 125_000, props: { level: 'warm-up' } }]);
    const r = computeReport(m.store.db, t0 + 10 * D);
    expect(r.players).toBe(2);
    expect(r.retention).toMatchObject({ d1: 0.5, d7: 0.5, d1Cohort: 2 });
    expect(r.sessionMinutes.median).toBeGreaterThan(0);
    expect(r.levels).toEqual([{ level: 'warm-up', starts: 2, finishes: 1, quits: 1, finishRate: 0.5 }]);
  });
});

describe('delete my data', () => {
  it('removes the account, progress and stats; keeps unlinked purchase records', () => {
    const m = fresh();
    const g = m.createGuest();
    m.recordSolo(g.accountId, levelId(LEVELS[0]), warmUp.updates);
    m.grantSku(g.accountId, 'starter-pack', 'cs_del');
    m.logEvents('anon-del', 's', [{ name: 'session_start', t: clock }]);
    m.deleteAccount(g.accountId, 'anon-del');
    expect(m.authenticate(g.token)).toBeNull();
    const count = (sql: string) => (m.store.db.prepare(sql).get() as { n: number }).n;
    expect(count(`SELECT COUNT(*) n FROM best_times WHERE account_id = '${g.accountId}'`)).toBe(0);
    expect(count(`SELECT COUNT(*) n FROM grants WHERE account_id = '${g.accountId}'`)).toBe(0);
    expect(count("SELECT COUNT(*) n FROM events WHERE anon_id = 'anon-del'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM purchases WHERE ref = 'cs_del' AND account_id = 'deleted'")).toBe(1);
    expect(m.leaderboard(levelId(LEVELS[0])).top).toEqual([]);
  });
});
