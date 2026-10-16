import { SIM, VIEW } from './config';
import { Multiplayer } from './game/multiplayer';
import { RaceSession } from './game/session';
import { LEVELS } from './levels';
import { parseLevel, type LevelData } from './levels/schema';
import { sfx, setVolume } from './render/audio';
import { CAMERA_LABELS, CameraRig, type CameraMode } from './render/camera';
import { drawCourseMap } from './render/course-map';
import { THEMES } from './levels/themes';
import { formatTime, Hud } from './render/hud';
import { Controls, type InputMode } from './render/input';
import { bestTime, medalFor, recordStars, recordTime, starsFound, type Medal } from './render/progress';
import { applyTheme, createStage } from './render/scene';
import { DRAFT_KEY, load } from './render/storage';
import { SettingsStore } from './render/settings';
import { AutoQuality, TIERS, type QualitySetting, type QualityTier } from './render/quality';
import { TrailView } from './render/cosmetics-view';
import { Motes, SUN_OFFSET } from './render/backdrop';
import { prewarmLooks } from './render/prewarm';
import { Effects } from './render/effects';
import { motion as motionSound } from './render/audio';
import { loadLook, saveLook } from './render/look-store';
import { renderCustomize } from './ui/customize';
import { Autopilot } from './sim/autopilot';
import { initPhysics, type Input, type SimEvent } from './sim/simulation';
import { Screens, type ScreenId } from './ui/screens';
import { CATALOG, ownedLook, owns, unlockOf, type Category } from './cosmetics';
import { courseDrop, courseMechanics, levelId, withoutStars } from './levels';
import type { SoloResult } from './meta/api';
import { Account } from './meta/client';
import { Analytics, forgetAnonId } from './platform/analytics';
import { detectPlatform } from './platform/platform';
import { renderLeaderboard, renderProfile, renderRewards, renderShop } from './ui/progress';
import { toast } from './ui/toast';
import { FeedbackForm } from './ui/feedback-form';
import { levelVersion, RunRecorder, type Feedback } from './meta/feedback';
import { exportFeedback, hasRated, keepEvent, playtestMode, ratingCount } from './render/feedback-store';

await initPhysics();

// `?sandbox=<segment>` tries one mechanic on its own: a short generated course of just that
// segment (levels/sandbox.ts). The generator only loads in this mode.
const sandbox = await (async () => {
  if (!new URLSearchParams(location.search).has('sandbox')) return null;
  const { parseSandbox, sandboxLevel, sandboxQuery } = await import('./levels/sandbox');
  try {
    const o = parseSandbox(location.search)!;
    const { level, seed } = sandboxLevel(o);
    return { o: { ...o, seed }, level, query: sandboxQuery };
  } catch (e) { alert(`Sandbox: ${String(e)}`); return null; }
})();
// `?play=draft` playtests the level being edited in the editor instead of the built-in courses.
// Sandbox courses play the same way: nothing is saved or sent.
const draft: LevelData | null = sandbox?.level ?? (() => {
  if (new URLSearchParams(location.search).get('play') !== 'draft') return null;
  try { return parseLevel(JSON.parse(load(DRAFT_KEY) ?? 'null')); } catch (e) { alert(`Can't playtest: ${String(e)}`); return null; }
})();
const playlist: LevelData[] = draft ? [draft] : LEVELS;
const toEditor = () => { location.href = `${import.meta.env.BASE_URL}editor.html`; };
/** The sandbox's "menu": a new layout of the same mechanic. */
const nextSandbox = () => { if (sandbox) location.search = sandbox.query({ ...sandbox.o, seed: sandbox.o.seed + 1 }); };
if (sandbox) {
  // Bottom-left: what's on, and links to change it.
  const { o, query } = sandbox;
  const tag = document.getElementById('sandbox-tag')!;
  const link = (label: string, next: Partial<typeof o>) => Object.assign(document.createElement('a'), { textContent: label, href: query({ ...o, ...next }) });
  const title = document.createElement('b');
  title.textContent = 'SANDBOX';
  tag.append(title, `${o.segment} · d ${o.d}`,
    link('easier', { d: Math.max(0, o.d - 0.25) }), link('harder', { d: Math.min(1, o.d + 0.25) }),
    link('new layout', { seed: o.seed + 1 }), link(o.star ? 'no star' : 'with star', { star: !o.star }));
  tag.hidden = false;
}

// ---------- Setup ----------
/** Single-player build (GitHub Pages etc.): no server, so no accounts, multiplayer, shop or stats. */
const SOLO = import.meta.env.VITE_PLATFORM === 'solo';
/** `?playtest`: ask for course feedback after every finish and quit (see render/feedback-store.ts). */
const PLAYTEST = playtestMode();
document.getElementById('playtest-tag')!.hidden = !PLAYTEST;
/** What happens on the player's runs (falls, splits, stars), for course feedback. */
const recorder = new RunRecorder();
const feedbackForm = new FeedbackForm();
const settings = new SettingsStore();
let look = loadLook();
const analytics = new Analytics();
analytics.enabled = !SOLO && settings.get().analytics === 'yes';
analytics.reportErrors = !SOLO;
const platform = await detectPlatform();
analytics.track('session_start', { platform: platform.name });

// Anonymous stats need a yes first (asked once, changeable in Settings).
const consent = document.getElementById('consent')!;
consent.hidden = SOLO || settings.get().analytics !== 'unset';
if (SOLO) {
  document.getElementById('profile-chip')!.hidden = true;
  document.getElementById('account-settings')!.hidden = true;
}
const answerConsent = (yes: boolean) => {
  settings.update({ analytics: yes ? 'yes' : 'no' });
  analytics.enabled = yes;
  consent.hidden = true;
  if (yes) analytics.track('session_start', { platform: platform.name });
};
document.getElementById('consent-yes')!.addEventListener('click', () => answerConsent(true));
document.getElementById('consent-no')!.addEventListener('click', () => answerConsent(false));

const stage = createStage(VIEW.camera.dynamic.fov);
const { renderer, scene, camera, sun } = stage;
const rig = new CameraRig(camera);
const hud = new Hud();
const screens = new Screens();

type Mode = 'menu' | 'playing' | 'paused' | 'results' | 'mp';
let mode: Mode = 'menu';
let session: RaceSession | null = null;
let levelIndex = 0;
let demo: Autopilot | null = null;   // menu background: a bot plays the course
let testPilot: Autopilot | null = null; // browser tests only (VITE_TEST_HOOKS): drive the player's ball
let demoFinishedAt = 0;
let resultsTimer: ReturnType<typeof setTimeout> | undefined;
let settingsReturn: ScreenId = 'menu';
let shopReturn: ScreenId = 'menu';
let boardReturn: ScreenId = 'results';
let pendingSolo: Promise<SoloResult | { error: string }> | null = null;
let lastClaim: string | null = null;

// Account: signs in (or creates a guest) in the background; the game works offline too.
// After the state above: subscribe() calls back right away and touches `session`.
const account = new Account();
account.subscribe((p) => {
  renderProfile(p);
  // Signed in, the server's equipped look wins; offline, only free items.
  look = p ? p.look : ownedLook(look, 1, new Set());
  saveLook(look);
  session?.ballView.setLook(look);
});
if (!SOLO) void account.init(load('hamball.name') ?? undefined);

// Graphics: a fixed tier, or Auto (starts by device type, steps down if frames get slow).
const autoQuality = new AutoQuality(AutoQuality.initialTier(matchMedia('(pointer: coarse)').matches), (tier) => {
  if (settings.get().quality === 'auto') applyTier(tier);
});
let particleShare = 1;
/** Motion effects: "reduced" turns off shake, FOV kicks and hit-stop, and halves particles. */
function applyMotionSetting() {
  const reduced = settings.get().effects === 'reduced';
  Effects.scale = particleShare * (reduced ? 0.5 : 1);
  CameraRig.motion = reduced ? 0 : 1;
}

function applyTier(tier: QualityTier) {
  const t = TIERS[tier];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, t.pixelRatio));
  sun.castShadow = t.shadows;
  if (sun.shadow.mapSize.x !== t.shadowMap) {
    sun.shadow.mapSize.set(t.shadowMap, t.shadowMap);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  TrailView.enabled = t.trails;
  Motes.enabled = t.motes;
  particleShare = t.particles;
  applyMotionSetting();
  analytics.track('quality_tier', { tier, auto: settings.get().quality === 'auto' });
}

/** Mazes start in the top-down camera until the player picks another with C. */
let cameraOverride: CameraMode | null = null;
function applyCameraMode() {
  rig.mode = cameraOverride ?? settings.get().cameraMode;
  hud.setCameraMode(CAMERA_LABELS[rig.mode]);
}

settings.subscribe((s) => {
  applyCameraMode();
  hud.setHelpVisible(s.showHelp);
  setVolume(s.volume);
  applyTier(s.quality === 'auto' ? autoQuality.tier : s.quality);
});

// ---------- Sessions ----------
function current(): RaceSession {
  if (!session) throw new Error('no session');
  return session;
}

function createSession(data: LevelData): RaceSession {
  session?.dispose();
  session = new RaceSession(scene, data);
  session.ballView.setLook(look);
  // A launched log breaking up: a woody crack, if it's near enough to hear.
  session.onLogBreak = (at) => {
    const p = session?.sim.position();
    if (p && Math.hypot(at[0] - p[0], at[1] - p[1], at[2] - p[2]) < 35) sfx.crack();
  };
  applyTheme(stage, session.level.theme);
  cameraOverride = data.camera === 'topdown' ? 'top' : null;
  applyCameraMode();
  hud.setLevel(session.level.name);
  hud.setStars(session.sim.stars);
  return session;
}

function loadLevel(index: number, asDemo: boolean) {
  levelIndex = index;
  createSession(playlist[index]);
  if (!session) return;
  demo = asDemo ? new Autopilot(session.sim) : null;
  hud.setBest(bestTime(session.level.name));
  restartRace();
  recorder.reset(); // a new course: no restarts yet
}

function restartRace() {
  const s = current();
  clearTimeout(resultsTimer);
  testPilot = null;
  s.restart();
  s.ballView.wake();
  recorder.reset(true);
  if (demo) {
    demo = new Autopilot(s.sim);
    while (s.sim.phase === 'countdown') s.sim.step({ x: 0, z: 0 }); // bots don't wait
    s.sim.drainEvents();
    demoFinishedAt = 0;
  }
  rig.snap(s.follow(), s.sim.spawn.yaw);
  s.ballView.faceYaw(s.sim.spawn.yaw);
  hud.hideBanner();
  hud.setStars(s.sim.stars);
  handle(s.sim.drainEvents());
}

// ---------- Mode changes ----------
function showMenu() {
  if (draft) return sandbox ? nextSandbox() : toEditor();
  if (mode === 'playing' || mode === 'paused') {
    const s = current(), props = runProps();
    analytics.track('level_quit', { ...props, time: s.sim.elapsed });
    keepEvent('level_quit', props);
    if (PLAYTEST && s.sim.phase === 'playing') {
      // Playtests: ask why they stopped, then on to the menu.
      platform.gameplayStop();
      mode = 'paused';
      hud.setVisible(false);
      return askFeedback(true, toMenu);
    }
  }
  toMenu();
}

function toMenu() {
  platform.gameplayStop();
  mode = 'menu';
  document.querySelector<HTMLElement>('#pause [data-action=restart]')!.hidden = false;
  loadLevel(Math.floor(Math.random() * playlist.length), true);
  hud.setVisible(false);
  screens.show('menu');
}

function startLevel(index: number) {
  loadLevel(index, false);
  analytics.track('level_start', { level: levelId(playlist[index]) });
  mode = 'playing';
  hud.setVisible(true);
  screens.show(null);
}

function pause() {
  if (mode !== 'playing') return;
  platform.gameplayStop();
  mode = 'paused';
  screens.show('pause');
}

function resume() {
  if (mode !== 'paused' || screens.current === 'feedback') return;
  platform.gameplayStart();
  mode = 'playing';
  screens.show(null);
}

function openSettings(returnTo: ScreenId) {
  settingsReturn = returnTo;
  syncSettingsForm();
  screens.show('settings');
}

// ---------- Multiplayer ----------
const mp = new Multiplayer({
  rig, hud, screens, scene,
  look: () => look,
  token: () => (account.online ? account.token : null),
  accountName: () => account.profile?.name ?? null,
  rename: (name) => void account.rename(name),
  onRewards: () => void account.refresh(),
  track: (name, props) => analytics.track(name, props),
  loadSession: (data) => createSession(withoutStars(data)), // stars are a solo thing (for now)
  session: current,
  setActive: (active) => {
    if (active) {
      mode = 'mp';
      demo = null;
      clearTimeout(resultsTimer);
    }
  },
  showMenu,
});

/** Esc / Start / pause button during a multiplayer race: a menu over the race (which keeps going). */
function mpPauseToggle() {
  if (screens.current === 'pause') screens.show(null);
  else if (mp.racing) {
    document.querySelector<HTMLElement>('#pause [data-action=restart]')!.hidden = true;
    screens.show('pause');
  }
}

// ---------- Screens ----------
screens.on('menu', {
  play: () => { renderLevelList(); screens.show('levels'); },
  quick: () => void mp.quickPlay(),
  customize: openCustomize,
  shop: () => openShop('menu'),
  multiplayer: () => mp.open(),
  settings: () => openSettings('menu'),
  editor: toEditor,
});
screens.on('levels', { back: () => screens.show('menu') });
screens.on('customize', { back: () => screens.show('menu') });
screens.on('shop', { back: () => screens.show(shopReturn) });
screens.on('leaderboard', { back: () => screens.show(boardReturn) });

// ---------- Customize, unlocks, shop ----------
const ownership = {
  owns: (cat: Category, i: number) => {
    if (SOLO) return !('sku' in unlockOf(cat, i)); // no progression server: everything but paid packs
    const p = account.profile;
    return p ? owns(p.level, new Set(p.bought), cat, i) : 'free' in unlockOf(cat, i);
  },
  onLocked: async (cat: Category, i: number) => {
    const u = unlockOf(cat, i);
    const label = CATALOG[cat][i].label;
    if (SOLO) return toast(`${label} is in the Starter Pack, coming with the full game.`, 3000);
    const p = account.profile;
    if (!p) return toast('Connect to the internet to unlock items.', 2500);
    if ('level' in u) return toast(`${label} unlocks at level ${u.level}.`, 2500);
    if ('sku' in u) {
      if (import.meta.env.VITE_PLATFORM && import.meta.env.VITE_PLATFORM !== 'web') return toast(`${label} is in the Starter Pack, available on our website.`, 3000);
      return openShop('customize');
    }
    if ('coins' in u) {
      if (p.coins < u.coins) return toast(`${label} costs 🪙 ${u.coins} — you have 🪙 ${p.coins}. Play to earn more!`, 3000);
      if (!confirm(`Unlock ${label} for 🪙 ${u.coins}?`)) return;
      const err = await account.buy(cat, i);
      if (err) return toast(err, 2500);
      analytics.track('item_bought', { item: `${cat}:${CATALOG[cat][i].id}`, coins: u.coins });
      toast(`${label} unlocked!`, 1500);
      openCustomize();
    }
  },
};

function openCustomize() {
  renderCustomize(look, (next) => {
    look = next;
    saveLook(look);
    session?.ballView.setLook(look);
    if (!SOLO) void account.equip(look);
  }, ownership);
  screens.show('customize');
}

function openShop(returnTo: ScreenId) {
  shopReturn = returnTo;
  analytics.track('shop_open');
  const render = () => renderShop(new Set(account.profile?.bought ?? []), async (sku) => {
    if (!account.online) return void (document.getElementById('shop-error')!.textContent = 'Connect to the internet to buy.');
    analytics.track('purchase_start', { sku });
    const r = await account.checkout(sku);
    if (r.error) document.getElementById('shop-error')!.textContent = r.error;
    else if (r.url) location.href = r.url; // Stripe Checkout; we come back with ?purchase=…
    else { toast('Unlocked! 🎉', 2000); render(); }
  });
  render();
  screens.show('shop');
}
screens.on('pause', {
  resume: () => (mode === 'mp' ? screens.show(null) : resume()),
  restart: () => { mode = 'playing'; screens.show(null); restartRace(); },
  settings: () => openSettings('pause'),
  quit: () => (mode === 'mp' ? void mp.leave() : showMenu()),
});
screens.on('results', {
  next: () => startLevel((levelIndex + 1) % playlist.length),
  retry: () => { mode = 'playing'; screens.show(null); hud.setVisible(true); restartRace(); },
  menu: showMenu,
  leaderboard: () => void openLeaderboard('results'),
  adDouble: () => void watchAdForDouble(),
  rate: () => askFeedback(false, () => screens.show('results')),
});
screens.on('settings', {
  back: () => screens.show(settingsReturn),
  exportFeedback: () => exportFeedback(analytics.anonymousId),
  copyCode: () => {
    const code = account.recoveryCode;
    if (code) void navigator.clipboard.writeText(code).then(() => toast('Recovery code copied', 1500), () => toast(code, 5000));
  },
  deleteData: async () => {
    if (!confirm('Delete your progress, unlocks and stats from our server and this device? This can\'t be undone.')) return;
    const err = await account.deleteEverything(analytics.anonymousId);
    if (err) return toast(`Couldn't delete: ${err}`, 3000);
    forgetAnonId();
    for (const key of Object.keys(localStorage)) if (key.startsWith('hamball.')) localStorage.removeItem(key);
    location.reload();
  },
  restore: async () => {
    const input = document.getElementById('restore-code') as HTMLInputElement;
    const msg = document.getElementById('restore-msg')!;
    msg.textContent = 'Restoring…';
    const err = await account.restore(input.value);
    msg.textContent = err ?? 'Welcome back! Your progress is on this device now.';
    if (!err) syncSettingsForm();
  },
});

async function openLeaderboard(returnTo: ScreenId) {
  boardReturn = returnTo;
  const data = current().data;
  renderLeaderboard(data.name, null);
  screens.show('leaderboard');
  renderLeaderboard(data.name, await account.leaderboard(levelId(data)));
}

/** Rewarded ad → the last reward's coins again (capped per day by the server). */
async function watchAdForDouble() {
  const claim = lastClaim;
  const btn = document.getElementById('btn-ad-double') as HTMLButtonElement;
  if (!claim) return;
  btn.disabled = true;
  analytics.track('ad_offer_taken');
  const watched = await platform.rewardedAd();
  if (!watched) { btn.disabled = false; return; }
  analytics.track('ad_watched');
  const r = await account.adDouble(claim);
  if (typeof r === 'number') {
    toast(`+${r} 🪙 — doubled!`, 2000);
    btn.hidden = true;
    lastClaim = null;
  } else {
    toast(r, 2500);
    btn.disabled = false;
  }
}

function medalBadge(medal: Medal | null): HTMLElement {
  const el = document.createElement('span');
  el.className = `medal ${medal ?? 'none'}`;
  el.textContent = medal ? medal[0].toUpperCase() + medal.slice(1) : 'No medal';
  return el;
}

function renderLevelList() {
  const list = document.getElementById('level-list')!;
  // Grouped by theme, in playlist order, each card with a top-down map of the course.
  const groups = new Map<string, HTMLElement[]>();
  playlist.forEach((level, i) => {
    const theme = level.theme ?? 'meadow';
    if (!groups.has(theme)) groups.set(theme, []);
    groups.get(theme)!.push(levelCard(level, i));
  });
  list.replaceChildren(...[...groups].flatMap(([theme, cards]) => {
    const heading = document.createElement('h3');
    heading.className = 'level-group';
    const { label, tagline } = THEMES[theme as keyof typeof THEMES];
    heading.textContent = label;
    // The story is told by the world itself: one line of feeling under its name.
    const line = document.createElement('span');
    line.className = 'tagline';
    line.textContent = tagline;
    heading.append(line);
    return [heading, ...cards];
  }));
}

function levelCard(level: LevelData, i: number): HTMLElement {
  const online = account.profile?.bests[levelId(level)]?.time ?? null;
  const local = bestTime(level.name);
  const best = online !== null && (local === null || online < local) ? online : local;
  const card = document.createElement('button');
  card.className = 'level-card';
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = `Course ${i + 1}`;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = level.name;
  const bestEl = document.createElement('span');
  bestEl.className = 'best';
  bestEl.textContent = best ? `Best ${formatTime(best)}` : 'Not finished yet';
  const map = document.createElement('canvas');
  map.className = 'map';
  map.width = 320;
  map.height = 200;
  drawCourseMap(map, level, starsFound(level.name));
  const tag = (text: string) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = text;
    num.append(' ', el);
  };
  if (level.camera === 'topdown') tag('Top-down');
  const drop = courseDrop(level);
  if (drop >= 30) tag(`Downhill ↓${Math.round(drop)} m`);
  const mechanics = document.createElement('span');
  mechanics.className = 'mechanics';
  mechanics.textContent = courseMechanics(level).join(' · ');
  const totalStars = level.pieces.filter((p) => p.type === 'star').length;
  if (totalStars) {
    const stars = document.createElement('span');
    stars.className = 'stars';
    stars.textContent = ` · ★ ${starsFound(level.name).size}/${totalStars}`;
    bestEl.append(stars);
  }
  card.append(map, num, name, ...(mechanics.textContent ? [mechanics] : []), bestEl, medalBadge(medalFor(best, level.medals)));
  card.addEventListener('click', () => startLevel(i));
  return card;
}

/**
 * The end of the journey (DESIGN.md → The story): the hamster curls up asleep in its ball under
 * the aurora, and the view drifts up to the stars. No words: it may be an escape, a dream or a
 * last moment, and players decide. Any key, click or tap skips to the results.
 */
const ENDING_MS = 7000;
function playEnding(then: () => void) {
  const s = current();
  s.ballView.sleep();
  rig.gazeUp();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    removeEventListener('keydown', finish);
    removeEventListener('pointerdown', finish);
    // Still watching it: not restarted (that clears the timer too) or gone back to the menu.
    if (mode === 'playing' && current() === s && s.sim.phase === 'finished') then();
  };
  const timer = resultsTimer = setTimeout(finish, ENDING_MS);
  setTimeout(() => {
    addEventListener('keydown', finish);
    addEventListener('pointerdown', finish);
  }, 1500); // not a key still held from the finish line
}

function showResults(time: number, isBest: boolean, newStars: number) {
  const s = current();
  const level = s.level;
  const best = bestTime(level.name);
  const medal = medalFor(time, level.medals);
  document.getElementById('result-title')!.textContent = medal ? 'Great run!' : 'Finish!';
  document.getElementById('result-time')!.textContent = formatTime(time);
  document.getElementById('result-medal')!.replaceChildren(medalBadge(medal));
  const starsEl = document.getElementById('result-stars')!;
  starsEl.replaceChildren();
  if (level.stars.length) {
    // One glyph per star on the course: bright if collected this run, faded if only on an
    // earlier run, hollow if never; the note spells out this run versus the course total.
    const total = level.stars.length;
    const before = draft ? new Set<number>() : starsFound(level.name);
    const found = s.sim.stars.filter((got, i) => got || before.has(i)).length;
    const thisRun = s.sim.stars.filter(Boolean).length;
    const glyphs = s.sim.stars.map((got, i) => {
      const glyph = document.createElement('span');
      glyph.textContent = got || before.has(i) ? '★' : '☆';
      if (!got && before.has(i)) {
        glyph.className = 'earlier';
        glyph.title = 'Found on an earlier run';
      }
      return glyph;
    });
    const note = document.createElement('small');
    const run = thisRun === total ? `All ${total} this run!${newStars ? ' 🎉' : ''}` : `This run: ${thisRun} / ${total}${newStars ? ` (${newStars} new)` : ''}`;
    note.textContent = thisRun === total ? run
      : found === total ? `${run} · all ${total} found on this course`
      : `${run} · ${found} / ${total} found on this course — try the risky lines`;
    starsEl.append(...glyphs, note);
  }
  document.getElementById('result-best')!.textContent = isBest ? 'New personal best!' : `Best ${formatTime(best ?? time)}`;
  const m = level.medals;
  document.getElementById('result-targets')!.textContent = m
    ? `Gold ≤ ${formatTime(m.gold)}   ·   Silver ≤ ${formatTime(m.silver)}   ·   Bronze ≤ ${formatTime(m.bronze)}`
    : '';
  document.querySelector<HTMLElement>('#results [data-action=next]')!.hidden = levelIndex === playlist.length - 1;
  mode = 'results';
  hud.setVisible(false);
  const rate = document.getElementById('btn-rate')!;
  rate.hidden = !!draft;
  rate.classList.toggle('primary', !draft && !hasRated(levelId(s.data), levelVersion(s.data)));
  screens.show('results');
  void showSoloRewards();
  if (PLAYTEST && !draft) askFeedback(false, () => screens.show('results'));
}

// ---------- Course feedback ----------
/** The course and this run, as sent with level_finish / level_quit / level_feedback. */
function runProps() {
  const s = current();
  return { level: levelId(s.data), v: levelVersion(s.data), run: recorder.snapshot(s.sim.elapsed) };
}

let afterFeedback = () => {};
/** Shows the feedback form (ratings, or `quit`: why they stopped); `then` runs on Send or Skip. */
function askFeedback(quit: boolean, then: () => void) {
  const s = current();
  feedbackForm.open(s.data, recorder.snapshot(s.sim.elapsed), { quit, comment: PLAYTEST });
  afterFeedback = then;
  screens.show('feedback');
}

screens.on('feedback', {
  send: () => {
    const s = current();
    const answers = feedbackForm.read();
    if (Object.keys(answers).length) {
      const fb: Feedback = { level: levelId(s.data), v: levelVersion(s.data), ...answers };
      analytics.track('level_feedback', { ...fb });
      keepEvent('level_feedback', { ...fb });
      toast('Thanks for the feedback!', 1500);
      document.getElementById('btn-rate')!.classList.remove('primary');
    }
    afterFeedback();
  },
  skip: () => afterFeedback(),
  back: () => afterFeedback(),
});

/** Once the server has checked the run: rewards, rank, and the ad-double offer. */
async function showSoloRewards() {
  const box = document.getElementById('result-rewards')!;
  const adBtn = document.getElementById('btn-ad-double') as HTMLButtonElement;
  adBtn.hidden = true;
  lastClaim = null;
  if (!pendingSolo) {
    renderRewards(box, [], draft ? '' : 'Offline — this run wasn\'t saved.');
    return;
  }
  renderRewards(box, [], 'Checking your run…');
  const r = await pendingSolo;
  if (mode !== 'results') return; // moved on (the feedback form or leaderboard on top is fine)
  if ('error' in r) {
    renderRewards(box, [], `Not saved: ${r.error}`);
    return;
  }
  renderRewards(box, [r.granted, ...r.challenges], r.rank ? `#${r.rank} on the leaderboard${r.isBest ? ' — new best!' : ''}` : '');
  lastClaim = r.granted.claimId;
  adBtn.hidden = !(r.granted.coins > 0 && (account.profile?.adDoublesLeft ?? 0) > 0);
  adBtn.disabled = false;
  adBtn.textContent = `📺 Double coins (+${r.granted.coins} 🪙)`;
}

// ---------- Settings form ----------
const form = {
  volume: document.getElementById('set-volume') as HTMLInputElement,
  camera: document.getElementById('set-camera') as HTMLSelectElement,
  sens: document.getElementById('set-sens') as HTMLInputElement,
  quality: document.getElementById('set-quality') as HTMLSelectElement,
  effects: document.getElementById('set-effects') as HTMLSelectElement,
  help: document.getElementById('set-help') as HTMLInputElement,
  analytics: document.getElementById('set-analytics') as HTMLInputElement,
};
form.analytics.addEventListener('change', () => answerConsent(form.analytics.checked));
function syncSettingsForm() {
  const ratings = ratingCount(), exportBtn = document.getElementById('btn-export-feedback')!;
  exportBtn.hidden = !ratings && !PLAYTEST;
  exportBtn.textContent = `📝 Export course feedback (${ratings})`;
  document.getElementById('recovery-code')!.textContent = account.online ? account.recoveryCode ?? '—' : 'offline';
  const s = settings.get();
  form.volume.value = String(s.volume);
  form.camera.value = s.cameraMode;
  form.sens.value = String(s.cameraSensitivity);
  form.quality.value = s.quality;
  form.effects.value = s.effects;
  form.help.checked = s.showHelp;
  form.analytics.checked = s.analytics === 'yes';
}
form.volume.addEventListener('input', () => { settings.update({ volume: Number(form.volume.value) }); sfx.beep(false); });
form.camera.addEventListener('change', () => {
  cameraOverride = null;
  settings.update({ cameraMode: form.camera.value as CameraMode });
});
form.sens.addEventListener('input', () => settings.update({ cameraSensitivity: Number(form.sens.value) }));
form.quality.addEventListener('change', () => settings.update({ quality: form.quality.value as QualitySetting }));
form.effects.addEventListener('change', () => settings.update({ effects: form.effects.value as 'full' | 'reduced' }));
form.help.addEventListener('change', () => settings.update({ showHelp: form.help.checked }));

// ---------- Input ----------
const inputMode = (): InputMode =>
  mode === 'playing' || (mode === 'mp' && screens.current === null)
    ? 'game'
    : screens.current && screens.current !== 'loading' ? 'menu' : 'none';

const controls = new Controls(renderer.domElement, rig, {
  restart: () => { if (mode === 'playing') restartRace(); },
  backToCheckpoint: () => { if (mode === 'playing' && current().sim.phase === 'playing') current().sim.respawn(); },
  toggleCamera: () => {
    const next = rig.nextMode;
    cameraOverride = null;
    settings.update({ cameraMode: next });
  },
  pause: () => (mode === 'mp' ? mpPauseToggle() : mode === 'playing' ? pause() : resume()),
  menuMove: (d) => screens.moveFocus(d),
  menuAdjust: (d) => screens.adjust(d),
  menuActivate: () => screens.activate(),
  menuBack: () => (mode === 'mp' && screens.current === 'pause' ? screens.show(null) : screens.back()),
}, inputMode, () => settings.get().cameraSensitivity);

// Pause automatically when the tab or window loses focus (also expected by web portals).
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', pause);

// ---------- Events ----------
/** Solo only, full motion: freeze the race for a moment (a star grab, a big landing). Steps are skipped, so times are unaffected. */
let hitStopUntil = 0;
function hitStop(ms: number) {
  if (mode === 'playing' && !demo && settings.get().effects === 'full') hitStopUntil = performance.now() + ms;
}

/** How the ball, camera and particles answer an event (the menu's demo bot gets the visuals too). */
function feel(e: SimEvent, s: RaceSession) {
  const p = s.sim.position(), v = s.sim.velocity(), ball = s.ballView, fx = s.effects;
  const under: [number, number, number] = [p[0], p[1] - 0.95, p[2]];
  const player = !demo;
  switch (e.type) {
    case 'impact':
      if (s.sim.grounded) {
        // A landing: dust, a squash, and for big ones a camera dip and a beat of hit-stop.
        fx.burst('dust', under, { strength: e.strength / 20 });
        const glints = THEMES[s.level.theme].look?.glints;
        if (glints) fx.burst('glints', under, { strength: e.strength / 20, color: glints });
        ball.squash(Math.min(0.45, e.strength / 40));
        if (player && e.strength > 14) rig.dip(Math.min(0.7, e.strength / 35));
        if (player && e.strength > 18) hitStop(50);
      } else ball.squash(Math.min(0.25, e.strength / 60));
      break;
    case 'boost':
      fx.burst('streak', p, { dir: v });
      if (player) rig.kickFov(8);
      break;
    case 'spring':
      fx.burst('dust', under, { strength: 0.6 });
      ball.squash(-0.35);
      if (player) rig.kickFov(4);
      break;
    case 'bump': {
      const b = s.sim.solidPose(e.solidId).position; // sliding bumpers: where it is now
      const away: [number, number, number] = [p[0] - b[0], 0, p[2] - b[2]];
      fx.burst('spark', [p[0] - away[0] * 0.3, p[1], p[2] - away[2] * 0.3], { dir: away, strength: 0.8, colors: THEMES[s.level.theme].look?.sprinkles });
      ball.squash(0.3);
      ball.dizzy();
      break;
    }
    case 'ballBump':
      fx.burst('spark', p, { strength: e.strength / 12 });
      ball.squash(Math.min(0.3, e.strength / 30));
      if (e.strength > 10) ball.dizzy();
      break;
    case 'crumble': {
      const c = s.level.solids[e.solidId].position;
      fx.burst('crumbs', [c[0], c[1], c[2]], { color: THEMES[s.level.theme].look?.crumbs });
      break;
    }
    case 'hazard':
      // Spikes: a bright spray where you touched them (the fall's poof follows).
      fx.burst('spark', under, { color: '#ffffff', strength: 0.9 });
      ball.squash(0.35);
      break;
    case 'smash':
      // Torn paper: flakes fluttering down and a few bright scraps flung forward.
      fx.burst('crumbs', [p[0], p[1] + 0.5, p[2]], { color: '#f7f1e3' });
      fx.burst('spark', p, { dir: v, color: '#fffaf0', strength: 0.6 });
      ball.squash(0.15);
      break;
    case 'star':
      fx.burst('sparkle', p);
      hitStop(70);
      break;
    case 'checkpoint': {
      const cp = s.level.checkpoints[e.index].position;
      fx.burst('sparkle', [cp[0], cp[1] + 0.5, cp[2]], { color: '#bfe9ff' });
      break;
    }
    case 'fall':
      // Back at the checkpoint: a poof, and the ball pops in.
      fx.burst('dust', [p[0], p[1] - 0.95, p[2]], { strength: 0.5, color: '#ffffff' });
      ball.pop();
      ball.dizzy();
      break;
    case 'finish':
      fx.burst('confetti', p);
      ball.cheer();
      break;
  }
}

function handle(events: SimEvent[]) {
  const s = current();
  const audible = !demo;
  for (const e of events) {
    if (audible && mode !== 'mp' && e.type !== 'finish') recorder.event(e, s.sim);
    feel(e, s);
    switch (e.type) {
      case 'countdown':
        if (!audible) break;
        sfx.beep(false);
        hud.showBanner(String(e.n));
        break;
      case 'go':
        if (!audible) break;
        platform.gameplayStart();
        sfx.beep(true);
        hud.showBanner('GO!', '', 700);
        break;
      case 'checkpoint':
        s.levelView.setCheckpoint(e.index, true);
        if (!audible) break;
        sfx.checkpoint();
        hud.showBanner('Checkpoint!', '', 900);
        break;
      case 'star': {
        s.levelView.setStar(e.index, true);
        if (!audible) break;
        sfx.star();
        hud.setStars(s.sim.stars);
        hud.popStars();
        const got = s.sim.stars.filter(Boolean).length;
        hud.showBanner('★ Star!', `${got} / ${s.sim.stars.length}`, 900);
        break;
      }
      case 'switch':
        if (!audible) break;
        sfx.click();
        hud.showBanner('⏱ Star unlocked!', `${e.time} s: go!`, 1200);
        break;
      case 'fall':
        rig.snap(s.follow(), s.sim.spawn.yaw);
        s.ballView.faceYaw(s.sim.spawn.yaw);
        if (!audible) break;
        sfx.fall();
        sfx.respawn();
        if (e.penalty) hud.showBanner('Oops!', `+${e.penalty}s`, 1000);
        break;
      case 'finish': {
        if (!audible) break;
        if (mode === 'mp') { // the server decides places; results come from the room
          sfx.finish();
          sfx.confetti();
          hud.showBanner('FINISH!', formatTime(e.time), 2000);
          break;
        }
        // The journey's end: the first finish of the last course plays a quiet beat before the results.
        const ending = !sandbox && !draft && s.data === LEVELS[LEVELS.length - 1] && bestTime(s.level.name) === null;
        const isBest = !sandbox && recordTime(s.level.name, e.time); // sandbox layouts come and go
        const newStars = draft ? [] : recordStars(s.level.name, s.sim.stars);
        hud.setBest(bestTime(s.level.name));
        platform.gameplayStop();
        recorder.event(e, s.sim); // before the snapshot below (the loop records the rest after this switch)
        const run = runProps();
        if (!sandbox) analytics.track('level_finish', { ...run, time: e.time, medal: medalFor(e.time, s.level.medals), stars: s.sim.stars.filter(Boolean).length });
        if (!draft) keepEvent('level_finish', run);
        // Built-in courses: send the run for the server to check (rewards, leaderboard).
        pendingSolo = !draft && account.online ? account.submitSolo(levelId(s.data), s.trace.slice()) : null;
        sfx.finish();
        if (ending) {
          playEnding(() => showResults(e.time, isBest, newStars.length));
          break;
        }
        sfx.confetti();
        hud.showBanner('FINISH!', formatTime(e.time), 1400);
        resultsTimer = setTimeout(() => showResults(e.time, isBest, newStars.length), 1400);
        break;
      }
      case 'bump':
        s.levelView.pulseBumper(e.solidId);
        if (!audible) break;
        sfx.bump();
        rig.addShake(0.35);
        break;
      case 'out':
        sfx.fall();
        hud.showBanner('Knocked out!', 'Watching the rest…', 2500);
        break;
      case 'ballBump':
        sfx.bump();
        rig.addShake(Math.min(0.5, e.strength / 30));
        break;
      case 'impact':
        if (!audible) break;
        if (s.sim.grounded) sfx.land(e.strength, THEMES[s.level.theme].look?.chime);
        else sfx.thud(e.strength);
        rig.addShake(e.strength / 40);
        break;
      case 'boost':
        if (!audible) break;
        sfx.boost();
        rig.addShake(0.15);
        break;
      case 'spring':
        s.levelView.bounceSpring(e.solidId);
        if (!audible) break;
        sfx.spring();
        if (THEMES[s.level.theme].look?.chime) sfx.chime();
        break;
      case 'crumble':
        if (audible) {
          const kind = THEMES[s.level.theme].look?.crumble.kind;
          sfx.crumble(kind === 'thinice' ? 'brittle' : kind === 'sticker' ? 'sparkle' : 'crunch');
        }
        break;
      case 'smash':
        if (audible) sfx.tear();
        break;
      case 'hazard':
        if (audible) sfx.spike();
        break;
    }
  }
}

// ---------- Ice ----------
let lastInput: Input = { x: 0, z: 0 };
let shavingsDue = 0, breathDue = 2;

/**
 * Ice answers the sliding: steering across or against the way you're sliding throws up ice
 * shavings (and returns how hard, 0..1, for the scrape's hiss), and your breath puffs in the
 * cold. Only how things look and sound: the sim never sees it.
 */
function coldFeel(s: RaceSession, dt: number): number {
  if (!THEMES[s.level.theme].look?.cold || s.sim.phase !== 'playing') return 0;
  const p = s.sim.position(), v = s.sim.velocity(), speed = Math.hypot(v[0], v[2]);
  const push = Math.hypot(lastInput.x, lastInput.z);
  let slip = 0;
  if (s.sim.grounded && speed > 4 && push > 0.3) {
    const along = (lastInput.x * v[0] + lastInput.z * v[2]) / (push * speed); // 1: pushing the way you slide
    slip = Math.min(1, speed / 14) * Math.min(1, Math.max(0, 0.85 - along) / 1.2);
  }
  if (slip > 0.15 && (shavingsDue -= dt) <= 0) {
    s.effects.burst('shavings', [p[0], p[1] - 0.9, p[2]], { dir: v, strength: slip });
    shavingsDue = 0.06;
  }
  if (Effects.scale >= 1 && (breathDue -= dt) <= 0) { // off on low graphics and with reduced motion
    const f = speed > 1 ? [v[0] / speed, v[2] / speed] : [0, -1];
    s.effects.burst('breath', [p[0] + f[0] * 1.15, p[1] + 0.25, p[2] + f[1] * 1.15], { dir: [f[0], 0, f[1]] });
    breathDue = 1.8 + Math.random() * 0.8;
  }
  return slip;
}

// ---------- Night ----------
let stardustDue = 0;

/** At night you leave stardust behind you: more the faster you go, and more in the air. */
function stardust(s: RaceSession, dt: number) {
  const color = THEMES[s.level.theme].look?.trail;
  if (!color || s.sim.phase !== 'playing') return;
  const v = s.sim.velocity(), speed = Math.hypot(v[0], v[1], v[2]);
  const rate = Math.max(0, speed - 6) / 10 * (s.sim.grounded ? 1 : 2.5); // bursts a frame
  if (rate <= 0 || (stardustDue -= dt) > 0) return;
  s.effects.burst('stardust', s.sim.position(), { dir: v, strength: Math.min(1.5, rate), color });
  stardustDue = 0.05;
}

// ---------- Loop: fixed-step simulation, interpolated rendering ----------
const MAX_STEPS = 12;
let accumulator = 0;
let last = performance.now();
let lastTick = 0; // whole seconds left on a switch star's timer, for the countdown ticks

// `?stats`: FPS, frame time, draw calls and the graphics tier (for testers and bug reports).
const statsEl = new URLSearchParams(location.search).has('stats') ? document.getElementById('stats')! : null;
if (statsEl) statsEl.hidden = false;
let statsFrames = 0, statsSince = performance.now();

function frame(now: number) {
  const frameMs = now - last;
  const dt = Math.min(0.1, frameMs / 1000);
  last = now;
  if (settings.get().quality === 'auto') autoQuality.sample(frameMs);
  if (statsEl && ++statsFrames && now - statsSince > 500) {
    const fps = (statsFrames * 1000) / (now - statsSince);
    const tier = settings.get().quality === 'auto' ? `auto:${autoQuality.tier}` : settings.get().quality;
    statsEl.textContent = `${fps.toFixed(0)} fps  ${(1000 / fps).toFixed(1)} ms\n${renderer.info.render.calls} draws  ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris\n${tier}`;
    statsFrames = 0;
    statsSince = now;
  }

  // Input first: a gamepad press may switch levels, which replaces the session.
  controls.poll(now);
  controls.updateCamera(dt);
  let s = current();

  const running = mode !== 'paused';
  if (running && now < hitStopUntil) accumulator = 0; // a beat of hit-stop: the race holds still
  else if (running) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= SIM.dt && steps < MAX_STEPS) {
      if (mode === 'mp') mp.beforeStep(s.sim);
      const input = demo ? demo.input() : testPilot ? testPilot.input() : mode === 'mp' ? mp.input(controls.move()) : controls.move();
      s.step(input);
      lastInput = input;
      if (!demo && mode === 'playing') recorder.step(s.sim);
      handle(s.sim.drainEvents());
      accumulator -= SIM.dt;
      steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0; // too far behind (tab was hidden): drop the backlog
    if (mode === 'mp') mp.afterSteps(s.sim);
  }

  // Menu background: when the bot finishes, move on to another course.
  if (demo && s.sim.phase === 'finished') {
    demoFinishedAt ||= now;
    if (now - demoFinishedAt > 2500) {
      loadLevel((levelIndex + 1) % playlist.length, true);
      s = current();
    }
  }

  const frameDt = running ? dt : 0;
  const pos = s.render(accumulator / SIM.dt, frameDt);
  if (mode === 'mp') mp.render(frameDt);
  rig.update(frameDt, mode === 'mp' ? mp.follow(s.follow(pos)) : s.follow(pos));
  sun.position.copy(rig.focus).add(SUN_OFFSET); // keep shadows centered on the ball (the sky's sun glow is in this direction)
  sun.target.position.copy(rig.focus);

  // Switch stars: the timer in the HUD, ticking through its last three seconds.
  if (demo) hud.setStarTimer(0);
  else if (running) {
    const left = Math.max(0, ...s.sim.switchUntil.map((until, i) => (s.sim.stars[i] ? 0 : until - s.sim.time)));
    hud.setStarTimer(left);
    const n = Math.ceil(left);
    if (n !== lastTick && n > 0 && n <= 3) sfx.tick();
    lastTick = n;
  }

  const vel = s.sim.velocity();
  hud.setTime(mode === 'mp' ? mp.clock(s.sim.elapsed) : s.sim.elapsed);
  hud.setSpeed(Math.hypot(vel[0], vel[2]));

  // The sound of moving, and particle sizing for this frame's view.
  const v = s.sim.velocity();
  const racing = !demo && s.sim.phase === 'playing' && (mode === 'playing' || mode === 'mp');
  const slip = running ? coldFeel(s, frameDt) : 0;
  if (running) stardust(s, frameDt);
  motionSound(Math.hypot(v[0], v[2]), s.sim.grounded, THEMES[s.level.theme].grip < 1, racing, slip);
  Effects.pixelsPerUnit = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Browser tests finish real races with the autopilot. Only in test builds: in production this
// would be a free way to farm rewards.
if (import.meta.env.VITE_TEST_HOOKS) {
  (window as unknown as { __autopilot: (route?: 'main' | 'stars') => void }).__autopilot = (route = 'main') => {
    if (mode === 'playing') testPilot = new Autopilot(current().sim, 16, { route });
  };
  (window as unknown as { __perf: () => object }).__perf = () => ({
    calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
  });
}

if (draft) startLevel(0);
else {
  showMenu();
  platform.loadingFinished();
  prewarmLooks(renderer, camera, scene); // while the menu is up: no stall on a theme's first course
  // Back from Stripe Checkout.
  const purchase = new URLSearchParams(location.search).get('purchase');
  if (purchase) {
    history.replaceState(null, '', location.pathname);
    if (purchase === 'success') {
      toast('Thank you! Your items are unlocking…', 4000);
      for (const ms of [2000, 6000, 15000]) setTimeout(() => void account.refresh(), ms); // the payment webhook may take a moment
    }
  }
  // Invite links: /?room=CODE joins that room straight away.
  const invite = new URLSearchParams(location.search).get('room');
  if (invite && !SOLO) {
    mp.open(invite);
    void mp.connect(invite);
  }
}
requestAnimationFrame(frame);
