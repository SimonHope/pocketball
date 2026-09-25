import { expect, test, type Browser, type Page } from '@playwright/test';

// Two real browsers in one room: create, join via invite link, ready up, race, leave.

async function player(browser: Browser) {
  const context = await browser.newContext(); // separate storage, like two different people
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { page, errors, close: () => context.close() };
}

const positions = (page: Page) => page.locator('#positions .pos');

test('two players: lobby → race → live positions → leave', async ({ browser }) => {
  const a = await player(browser);
  const b = await player(browser);
  try {
    await a.page.goto('/');
    await a.page.click('[data-action=multiplayer]');
    await a.page.click('#mp [data-action=create]');
    await expect(a.page.locator('#lobby')).toBeVisible({ timeout: 15_000 });
    const code = (await a.page.locator('#lobby-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    await b.page.goto(`/?room=${code}`); // invite link
    await expect(b.page.locator('#lobby')).toBeVisible({ timeout: 15_000 });
    await expect(a.page.locator('#lobby-players .p')).toHaveCount(2);
    await expect(a.page.locator('#lobby-start')).toBeDisabled();

    await b.page.click('#lobby-ready');
    await expect(a.page.locator('#lobby-start')).toBeEnabled();
    await a.page.click('#lobby-start');

    for (const p of [a.page, b.page]) await expect(p.locator('#banner')).toHaveText('GO!', { timeout: 8000 });
    await a.page.keyboard.down('KeyW');
    await b.page.keyboard.down('KeyW');
    await a.page.waitForTimeout(600);
    await b.page.keyboard.up('KeyW');
    await a.page.waitForTimeout(800);
    await a.page.keyboard.up('KeyW');

    // Both see both racers, and agree on who's ahead.
    await expect(positions(a.page)).toHaveCount(2);
    await expect(positions(b.page)).toHaveCount(2);
    const leaderA = await positions(a.page).first().textContent();
    await expect(positions(b.page).first()).toHaveText(leaderA!);
    await expect(positions(a.page).first()).toHaveClass(/me/); // A kept rolling longer

    await a.page.keyboard.press('Escape');
    await expect(a.page.locator('#pause')).toBeVisible();
    await expect(a.page.locator('#pause [data-action=restart]')).toBeHidden();
    await a.page.click('#pause [data-action=quit]');
    await expect(a.page.locator('#menu')).toBeVisible();
    await expect(positions(b.page)).toHaveCount(1);

    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test('a wrong room code shows a friendly error', async ({ browser }) => {
  const a = await player(browser);
  try {
    await a.page.goto('/');
    await a.page.click('[data-action=multiplayer]');
    await a.page.fill('#mp-code', 'ZZZZZZ');
    await a.page.click('#mp [data-action=join]');
    await expect(a.page.locator('#mp-error')).toContainText('No open room with code ZZZZZZ');
  } finally {
    await a.close();
  }
});

test('Quick Play: lobby counts down, bots fill the race', async ({ browser }) => {
  const a = await player(browser);
  try {
    await a.page.goto('/');
    await a.page.click('[data-action=quick]');
    await expect(a.page.locator('#lobby')).toBeVisible({ timeout: 15_000 });
    await expect(a.page.locator('#lobby-title')).toHaveText('Quick Play');
    await expect(a.page.locator('#lobby-hint')).toContainText('Starts in');
    await expect(a.page.locator('#lobby')).toBeHidden({ timeout: 25_000 }); // game starts by itself
    await expect(a.page.locator('#positions .pos').nth(5)).toBeVisible({ timeout: 15_000 }); // top 6 (+ you if further back)
    await expect(a.page.locator('#positions')).toContainText('🤖');
    // Performance budget: an 8-racer race must stay phone-friendly (was 482 draw calls before M5).
    const perf = await a.page.evaluate(() => (window as unknown as { __perf: () => { calls: number } }).__perf());
    expect(perf.calls).toBeLessThan(260);
    expect(a.errors).toEqual([]);
  } finally {
    await a.close();
  }
});
