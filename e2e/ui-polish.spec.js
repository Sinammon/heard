import { expect, test } from '@playwright/test';
import { mockAIPractice } from './fixtures.js';

test('the journey explains every step and review tabs show distinct examples', async ({ page }) => {
  await page.goto('/');
  for (const title of ['Prepare your script', 'Practice your speech', 'Review your delivery']) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
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
  await expect(page.locator('#start-hint')).toContainText('Enable your camera');
  await page.getByRole('button', { name: 'Enable camera & microphone' }).click();
  await expect(page.locator('#start-hint')).toContainText('You’re ready');
  await expect(page.getByRole('button', { name: 'Start practice', exact: true })).toBeEnabled();
});
