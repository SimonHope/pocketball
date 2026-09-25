# Soft launch checklist (M5)

**Goal:** one web portal (CrazyGames) plus itch.io, with a small audience. Measure, fix, then launch wider in M6.

**Exit test:** at least 25–30% of players come back the next day (`npm run analytics`), and the servers stay stable at real player counts.

## Builds

- `VITE_SERVER_URL=wss://<server> npm run build:portal -- crazygames` → `release/pocket-ball-crazygames.zip`. Also `poki` and `itch`.
- **Portal builds differ from the web build:**
  - relative paths
  - the portal's SDK loaded
  - no Shop and no Level Editor (portals don't allow outside payments)
  - Starter Pack items say "on our website"
- **Our own site:** `npm run build` (with the Shop). Host `dist/` on any static host with HTTPS.

## Before submitting

- [ ] Server deployed and healthy (`deploy.md`), and `VITE_SERVER_URL` points at it.
- [ ] Portal SDK checked against the portal's current docs: ads (`src/platform/platform.ts`), gameplay start/stop, loading-finished.
- [ ] Portal rules: no external links or payments inside the game (the portal build removes the Shop; also check the privacy and terms links are allowed or pointed at the portal's pages), mobile support, loading-time and size limits, age rating.
- [ ] Legal pages finalized by a lawyer (`legal.md`).
- [ ] Device check (see below).
- [ ] Analytics working: accept the consent notice on a test device, play a course, then check `npm run analytics`.
- [ ] Error reports working: throw a test error in the console on a test device and check it's listed.

## Device check (real devices, not emulators)

Open the game with `?stats` to see FPS, draw calls and the graphics tier.

| Device | Target | Check |
|---|---|---|
| Low-end Windows laptop (integrated GPU), Chrome | 60 fps in an 8-player Quick Play race | Auto quality should settle on High or Medium |
| Mid-range Android phone (~3 years old), Chrome | 30+ fps | Should settle on Medium or Low; touch joystick usable |
| iPhone (a few years old), Safari | 30+ fps | Audio starts after the first tap; the touch joystick doesn't scroll the page |
| Chromebook | 30+ fps | Keyboard and touch |

Automated budget: the browser tests fail if an 8-racer race needs 260+ draw calls (it's about 206 now, down from 482).

## During the soft launch

- **Every day:** `npm run analytics` for players, D1 retention, the course funnel (which courses people quit) and errors. Check server metrics and uptime.
- **Every week:** fix the top errors, retune the hardest-quit courses, and check medal times against real finish times.
- **Watch:** Quick Play wait times (bots cover empty lobbies), disconnects (reconnect rate), and any anti-cheat strikes on real players (possible false positives: check `DEBUG_STRIKES=1` logs).
