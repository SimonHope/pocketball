import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Portal uploads: relative paths, the portal's SDK, and no shop or editor.

const out = mkdtempSync(join(tmpdir(), 'pocket-ball-portal-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

function build(platform: string) {
  const dir = join(out, platform);
  const r = spawnSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], {
    env: { ...process.env, VITE_PLATFORM: platform }, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return { dir, html: readFileSync(join(dir, 'index.html'), 'utf8') };
}

describe('portal builds', () => {
  it('CrazyGames: SDK script, relative asset paths, no shop or editor', () => {
    const { dir, html } = build('crazygames');
    expect(html).toContain('sdk.crazygames.com/crazygames-sdk-v3.js');
    expect(html).toMatch(/src="\.\/assets\//);
    expect(html).not.toContain('data-action="shop"');
    expect(html).not.toContain('data-action="editor"');
    expect(existsSync(join(dir, 'editor.html'))).toBe(false);
    expect(existsSync(join(dir, 'privacy.html'))).toBe(true); // legal pages ship everywhere
  }, 120_000);

  it('Poki gets its own SDK', () => {
    expect(build('poki').html).toContain('game-cdn.poki.com/scripts/v2/poki-sdk.js');
  }, 120_000);

  it('the single-player build (GitHub Pages): relative paths, editor kept, nothing online', () => {
    const { dir, html } = build('solo');
    expect(html).toMatch(/src="\.\/assets\//); // works under /<repo>/ on GitHub Pages
    for (const online of ['quick', 'multiplayer', 'shop', 'leaderboard']) expect(html).not.toContain(`data-action="${online}"`);
    expect(html).toContain('<button class="primary" data-action="play">Play</button>');
    expect(html).toContain('data-action="editor"');
    expect(existsSync(join(dir, 'editor.html'))).toBe(true);
  }, 120_000);

  it('the web build keeps the shop and editor, absolute paths', () => {
    const { dir, html } = build('web');
    expect(html).toContain('data-action="shop"');
    expect(html).not.toContain('sdk.crazygames');
    expect(readdirSync(dir)).toContain('editor.html');
  }, 120_000);
});
