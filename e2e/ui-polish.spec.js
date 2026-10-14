import { expect, test } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';

test('the compact landing journey and review explorer remain usable', async ({ page }) => {
  await page.goto('/');
  const journey = page.getByRole('list', { name: 'Your practice journey' });
  await expect(journey.getByRole('listitem')).toHaveText(['Prepare', 'Record', 'Review']);
  await expect(page.locator('.hero-copy')).toContainText(
    'Record your speech. Get feedback on pace, pauses, and delivery.',
  );
  await expect(page.locator('.hero-copy button')).toHaveCount(1);
  await expect(page.locator('#practice-topic')).toHaveCount(0);
  await expect(page.locator('.studio-illustration')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.studio-illustration :is(button, input, video, audio)')).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: 'How it works', exact: true }).click();
  await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveText('How it works');
  await expect(page.locator('#demo-panel')).toContainText('142');
  await page.getByRole('tab', { name: 'Watch', exact: true }).click();
  await expect(page.locator('#demo-panel')).toContainText('Shoulder alignment');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Reflect', exact: true })).toBeFocused();
  await expect(page.locator('#demo-panel')).toContainText('Give your last line room.');
  await expect(page.locator('#demo-panel')).toContainText('Illustrative example');
  await page.locator('#how-it-works').getByRole('link', { name: 'Start practicing' }).click();
  await expect(page.locator('#nav-action')).toHaveText('Back to home');
});

test('the reference layout fits desktop, tablet, and mobile without activating devices', async ({
  page,
}) => {
  const deviceRequests = [];
  await page.exposeFunction('recordDeviceRequest', () => deviceRequests.push('requested'));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      await window.recordDeviceRequest();
      throw new Error('Landing illustrations must not request devices.');
    };
  });
  await page.goto('/');
  for (const width of [320, 390, 768, 1280, 1586]) {
    await page.setViewportSize({ width, height: 992 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `No horizontal overflow at ${width}px`,
    ).toBe(true);
    expect(
      await page.locator('.hero-copy h1').evaluate((el) => el.scrollWidth <= el.clientWidth),
      `Slogan fits at ${width}px`,
    ).toBe(true);
    await expect(page.locator('.hero-cta')).toBeVisible();
    for (const name of ['Home', 'How it works', 'Our approach']) {
      await expect(
        page.getByRole('navigation', { name: 'Main navigation' }).getByText(name, { exact: true }),
      ).toBeVisible();
    }
  }
  expect(deviceRequests).toEqual([]);
  await page.locator('.hero-cta').click();
  await expect(page.getByLabel('Your practice script')).toBeVisible();
  await page.getByRole('tab', { name: 'Draft with AI' }).click();
  await expect(page.getByLabel('What would you like to talk about?')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#nav-action').click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
});

test('duration and setup guidance match the available practice actions', async ({ page }) => {
  await mockAIPractice(page);
  await page.goto('/#studio');
  await expect(page.locator('#prepare-hint')).toContainText('Add at least 3 words');
  await page.getByLabel('Your practice script').fill('Practice makes progress.');
  await expect(page.locator('#estimated')).toContainText('1 second');
  await page.getByLabel('Your practice script').fill('word '.repeat(800));
  await expect(page.locator('#estimated')).not.toContainText('limit');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.locator('.scoring-note')).toContainText('30 seconds');
  await expect(page.locator('.scoring-note')).toContainText('50 timestamped words');
  await expect(page.locator('#camera-status')).toContainText('Accept AI processing');
  await page.locator('#consent').check();
  await expect(page.locator('#consent')).toBeFocused();
  await page.locator('#camera-enabled').check();
  await expect(page.locator('#start-hint')).toContainText('Enable your microphone');
  await page.locator('#enable-camera').click();
  await expect(page.locator('#start-hint')).toContainText('You’re ready');
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
});
