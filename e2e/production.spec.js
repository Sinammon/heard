import { expect, test } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';

test('landing action reaches Studio topic entry and the draft persists across refresh', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ok: true, aiConfigured: true } }),
  );
  let releaseDraft;
  const ready = new Promise((resolve) => {
    releaseDraft = resolve;
  });
  await page.route('**/api/scripts', async (route) => {
    expect(route.request().postDataJSON().topic).toBe('Introduce an idea to my class');
    await ready;
    await route.fulfill({
      json: { script: 'One small habit can help us learn. Let me show you how it works.' },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await page.getByRole('tab', { name: 'Draft with AI' }).click();
  await page.getByLabel('What would you like to talk about?').fill('Introduce an idea to my class');
  await page.getByRole('button', { name: 'Generate a draft' }).click();
  await expect(page.getByRole('button', { name: 'Drafting your script' })).toBeDisabled();
  await expect(page.getByLabel('Your practice script')).toHaveAttribute('readonly', '');
  releaseDraft();
  await expect(page.getByLabel('Your practice script')).toHaveValue(/One small habit/);
  await expect(page.getByRole('status')).toContainText([
    'Your draft is ready',
    'Draft kept in this tab',
  ]);
  await page
    .getByLabel('Your practice script')
    .fill('This is my own version of the idea. I want to keep it.');
  await page.reload();
  await expect(page.getByLabel('Your practice script')).toHaveValue(
    'This is my own version of the idea. I want to keep it.',
  );
});

test('malformed draft responses preserve the existing script and offer recovery', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ok: true, aiConfigured: true } }),
  );
  await page.route('**/api/scripts', (route) => route.fulfill({ json: { script: null } }));
  await page.goto('/#studio');
  await page.getByLabel('Your practice script').fill('This is the draft I want to preserve.');
  await page.getByRole('tab', { name: 'Draft with AI' }).click();
  await page.getByLabel('What would you like to talk about?').fill('Trying a new habit');
  await page.getByRole('button', { name: 'Generate a draft' }).click();
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await expect(page.getByLabel('Your practice script')).toHaveValue(
    'This is the draft I want to preserve.',
  );
  await expect(page.getByRole('button', { name: 'Generate a draft' })).toBeEnabled();
});

test('practice requires explicit AI consent before devices or sessions', async ({ page }) => {
  await mockAIPractice(page);
  const cloudRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/sessions')) cloudRequests.push(request.url());
  });
  await page.goto('/#studio');
  await page.getByLabel('Your practice script').fill('A short practice with required AI review.');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.locator('#consent')).not.toBeChecked();
  await expect(page.locator('#enable-camera')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeDisabled();
  await expect(page.getByText(/Consent is required before enabling devices/)).toBeVisible();
  expect(cloudRequests).toEqual([]);
  await page.locator('#consent').check();
  await page.locator('#camera-enabled').check();
  await expect(page.locator('#enable-camera')).toBeEnabled();
  await page.locator('#consent').uncheck();
  await expect(page.locator('#enable-camera')).toBeDisabled();
});

test('missing AI blocks practice while preserving script preparation', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ok: true, aiConfigured: false } }),
  );
  await page.goto('/#studio');
  await page
    .getByLabel('Your practice script')
    .fill('Prepare this script while AI is unavailable.');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.locator('#consent')).toBeDisabled();
  await expect(page.locator('#enable-camera')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to preparation' }).click();
  await expect(page.getByLabel('Your practice script')).toHaveValue(/Prepare this script/);
});

test('script source tabs support arrow-key selection', async ({ page }) => {
  await page.goto('/#studio');
  await page.getByRole('tab', { name: 'Write my own' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Draft with AI' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Draft with AI' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Write my own' })).toBeFocused();
});

test('home, about, studio, and setup fit phone and tablet viewports', async ({ page }) => {
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/#about', '/#studio']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page
      .getByLabel('Your practice script')
      .fill('A practice script that fits every viewport.');
    await page.getByRole('button', { name: 'Set up my recording' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('three-stage studio navigation and denied devices keep preparation recoverable', async ({
  page,
}) => {
  await mockAIPractice(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    };
  });
  await page.goto('/#studio');
  await expect(page).toHaveTitle('Speaking studio — Heard');
  const steps = page.getByRole('navigation', { name: 'Practice progress' });
  await expect(steps.getByRole('listitem')).toHaveCount(3);
  await expect(steps.locator('[aria-current="step"]')).toContainText('Prepare');
  await page.getByLabel('Your practice script').fill('Keep this script when device access fails.');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(steps.locator('[aria-current="step"]')).toContainText('Practice');
  await page.locator('#consent').check();
  await page.locator('#camera-enabled').check();
  await page.locator('#enable-camera').click();
  await expect(page.getByRole('alert')).toContainText('access was denied');
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeDisabled();
  await expect(page.locator('#enable-camera')).toBeEnabled();
  await page.getByRole('button', { name: 'Back to preparation' }).click();
  await expect(page.getByLabel('Your practice script')).toHaveValue(
    'Keep this script when device access fails.',
  );
});
