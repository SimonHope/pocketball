import { expect, test, type Page } from '@playwright/test';

// Fails the test on any uncaught error or console error.
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test('menu → race → pause → quit', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible();

  await page.click('[data-action=play]');
  await expect(page.locator('.level-card')).toHaveCount(28);
  await page.locator('.level-card').first().click();
  await expect(page.locator('#level')).toHaveText('Warm-Up');

  // Countdown, then roll forward for a moment.
  await expect(page.locator('#banner')).toHaveText('GO!', { timeout: 6000 });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  const speed = parseInt((await page.locator('#speed').textContent()) ?? '0', 10);
  expect(speed).toBeGreaterThan(10);
  expect(parseFloat((await page.locator('#timer').textContent()) ?? '0')).toBeGreaterThan(0.5);

  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  await page.click('#pause [data-action=quit]');
  await expect(page.locator('#menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('level select: maps by theme; mazes start top-down and C cycles cameras', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.click('[data-action=play]');
  await expect(page.locator('#level-list .level-group')).toHaveText(['Meadow', 'Candy', 'Ice', 'Night']);
  // Every card has a drawn map (some non-transparent pixels).
  const drawn = await page.locator('.level-card canvas.map').evaluateAll((maps) => maps.map((c) => {
    const { data } = (c as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 320, 200);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  }));
  expect(drawn).toHaveLength(28);
  expect(Math.min(...drawn)).toBeGreaterThan(2000);
  await expect(page.locator('.level-card .tag', { hasText: 'Top-down' })).toHaveCount(4);
  await expect(page.locator('.level-card', { hasText: 'Summit Run' }).locator('.tag')).toHaveText(/Downhill ↓\d+ m/);

  await page.locator('.level-card', { hasText: 'Hedge Maze' }).click();
  await expect(page.locator('#cam')).toHaveText('Camera: top-down (C)');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#cam')).toHaveText('Camera: chase (C)');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#cam')).toHaveText('Camera: fixed (C)');
  await page.keyboard.press('KeyC');
  await expect(page.locator('#cam')).toHaveText('Camera: top-down (C)');
  await page.keyboard.press('KeyC'); // back to the default for the other tests
  expect(errors).toEqual([]);
});

test('settings persist across reloads', async ({ page }) => {
  await page.goto('/');
  await page.click('#menu [data-action=settings]');
  await page.selectOption('#set-camera', 'fixed');
  await page.reload();
  await page.click('#menu [data-action=settings]');
  await expect(page.locator('#set-camera')).toHaveValue('fixed');
});

test('editor: validate, bot check, playtest', async ({ page }) => {
  const errors = watchErrors(page);
  page.on('dialog', (d) => d.accept());
  await page.goto('/editor.html');
  await expect(page.locator('#status')).toContainText('Valid');

  await page.click('#btn-bot');
  await expect(page.locator('#status')).toContainText('Bot finished');

  await page.click('#btn-play');
  await expect(page).toHaveURL(/play=draft/);
  await expect(page.locator('#level')).toHaveText('New Course');
  expect(errors).toEqual([]);
});

// Regression: starting a level from a gamepad press happens inside the frame loop and
// used to keep stepping the old, freed physics world ("null pointer passed to rust").
test('gamepad: navigate menus, race, pause', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const pad = {
      connected: true, index: 0, id: 'test pad', mapping: 'standard', axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    (window as unknown as { pad: typeof pad }).pad = pad;
    navigator.getGamepads = () => [pad as unknown as Gamepad];
  });
  // Hold each press for exactly one rendered frame. The game reads the pad once per frame (its
  // frame callback runs before ours), so it sees the press once. A fixed wait can miss a slow
  // frame, and holding across two frames can count as "held down" and repeat when a single
  // frame takes over 350 ms (software rendering right after load).
  const press = (button: number) => page.evaluate(async (b) => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const pad = (window as unknown as { pad: { buttons: { pressed: boolean }[] } }).pad;
    pad.buttons[b].pressed = true;
    await frame();
    pad.buttons[b].pressed = false;
    await frame();
  }, button);
  const stick = (y: number) => page.evaluate((v) => { (window as unknown as { pad: { axes: number[] } }).pad.axes[1] = v; }, y);

  await page.goto('/');
  await expect(page.locator('#menu')).toBeVisible();
  await press(13); // D-pad down: Quick Play → Solo
  await press(0); // A: Solo
  await expect(page.locator('#levels')).toBeVisible();
  await press(0); // A: first course
  await expect(page.locator('#levels')).toBeHidden();
  await expect(page.locator('#level')).toHaveText('Warm-Up');
  await expect(page.locator('#banner')).toHaveText('GO!', { timeout: 6000 });
  await stick(-1);
  await page.waitForTimeout(800);
  await stick(0);
  expect(parseInt((await page.locator('#speed').textContent()) ?? '0', 10)).toBeGreaterThan(10);
  await press(9); // Start: pause
  await expect(page.locator('#pause')).toBeVisible();
  await press(1); // B: resume
  await expect(page.locator('#pause')).toBeHidden();
  expect(errors).toEqual([]);
});

test('customize: free items equip and persist; locked ones show how to unlock', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#profile-chip')).toContainText('Lv 1'); // guest account created
  await page.click('[data-action=customize]');
  await expect(page.locator('#choose-hat button', { hasText: 'Crown' })).toContainText('🔒 Lv 10');
  await expect(page.locator('#choose-trail button', { hasText: 'Rainbow' })).toContainText('🔒 Shop');
  await page.locator('#choose-fur button', { hasText: 'Cream' }).click();
  await expect(page.locator('#choose-fur button.sel')).toContainText('Cream');
  await page.waitForTimeout(500); // equip is saved on the account
  await page.reload();
  await page.click('[data-action=customize]');
  await expect(page.locator('#choose-fur button.sel')).toContainText('Cream');
  expect(errors).toEqual([]);
});

test('solo run: the server checks it and pays rewards', async ({ page }) => {
  test.setTimeout(150_000); // the autopilot plays all of Warm-Up (about 46 s)
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#profile-chip')).toContainText('Lv 1');
  // Play the course with the same autopilot the tests use, driven through the real game loop.
  await page.click('[data-action=play]');
  await page.locator('.level-card').first().click();
  await expect(page.locator('#banner')).toHaveText('GO!', { timeout: 8000 });
  await page.evaluate(() => (window as unknown as { __autopilot?: () => void }).__autopilot?.());
  await expect(page.locator('#results')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-rewards')).toContainText('XP', { timeout: 10_000 });
  await expect(page.locator('#result-rewards')).toContainText('on the leaderboard');
  await page.click('#results [data-action=leaderboard]');
  await expect(page.locator('#board-list .me').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('privacy: stats are asked for once; nothing is sent without a yes', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/events')) sent.push(r.url()); });
  await page.goto('/');
  await expect(page.locator('#consent')).toBeVisible();
  await page.click('#consent-no');
  await expect(page.locator('#consent')).toBeHidden();
  await page.click('[data-action=play]');
  await page.locator('.level-card').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // would flush
  await page.reload();
  await expect(page.locator('#consent')).toBeHidden(); // remembered
  expect(sent).toEqual([]);
});

test('delete my data wipes the account and starts fresh', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await expect(page.locator('#profile-chip')).toContainText('Lv 1');
  const before = await page.evaluate(() => localStorage.getItem('hamball.token'));
  await page.click('#consent-no'); // dismiss the notice first
  await page.click('#menu [data-action=settings]');
  await Promise.all([page.waitForEvent('framenavigated'), page.click('#settings [data-action=deleteData]')]); // reloads
  await expect(page.locator('#profile-chip')).toContainText('Lv 1'); // a brand-new guest
  expect(await page.evaluate(() => localStorage.getItem('hamball.token'))).not.toBe(before);
  await expect(page.locator('#consent')).toBeVisible(); // choices were wiped too
});
