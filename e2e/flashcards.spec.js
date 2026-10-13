import { expect, test } from '@playwright/test';
import { mockAIPractice, talkingPoints } from './fixtures.js';

async function prepare(page) {
  await mockAIPractice(page);
  await page.goto('/#studio');
  await page
    .getByLabel('Your practice script')
    .fill(
      'A small daily habit can make learning easier. Repetition builds familiarity. Choose one useful thing to practice today.',
    );
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.getByRole('button', { name: 'I’ve read my script once' })).toBeDisabled();
  await page.locator('#consent').check();
}

test('confirmed reading produces safe adaptive cards and edits invalidate them', async ({
  page,
}) => {
  await prepare(page);
  const points = [
    ...talkingPoints,
    { title: 'A comparison', cue: 'Compare two approaches to learning.' },
    { title: '<img src=x onerror="window.bad=true">', cue: 'This fixture checks safe rendering.' },
  ];
  await page.route('**/api/flashcards', (route) => {
    expect(route.request().postDataJSON().cloudConsent).toBe(true);
    expect(route.request().postDataJSON().script).toContain('daily habit');
    return route.fulfill({ json: { points } });
  });
  await page.getByRole('button', { name: 'I’ve read my script once' }).click();
  await expect(page.locator('.flashcard')).toHaveCount(5);
  await expect(
    page.getByText('Use these 5 talking points as cues.', { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.bad)).toBeUndefined();
  await expect(page.locator('.flashcard img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to script' }).click();
  await page
    .getByLabel('Your practice script')
    .fill('An entirely different script with new ideas.');
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.locator('.flashcard')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'I’ve read my script once' })).toBeVisible();
});

test('quota failure can retry and card updates leave camera preview mounted', async ({ page }) => {
  await prepare(page);
  let requests = 0;
  await page.route('**/api/flashcards', (route) => {
    requests++;
    return requests === 1
      ? route.fulfill({
          status: 429,
          json: { error: 'The Gemini quota is exhausted. Retry later.' },
        })
      : route.fulfill({ json: { points: talkingPoints } });
  });
  await page.getByRole('button', { name: 'Enable camera & microphone' }).click();
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeEnabled();
  await page.locator('#preview').evaluate((el) => {
    window.previewBeforeCards = el;
  });
  await page.getByRole('button', { name: 'I’ve read my script once' }).click();
  await expect(page.getByText(/quota is exhausted/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry talking points' }).click();
  await expect(page.locator('.flashcard')).toHaveCount(3);
  expect(
    await page
      .locator('#preview')
      .evaluate((el) => el === window.previewBeforeCards && el.srcObject.active),
  ).toBe(true);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await page.getByRole('link', { name: 'Start practicing', exact: false }).first().click();
  expect(await page.evaluate(() => window.previewBeforeCards.srcObject.active)).toBe(false);
  await expect(page.locator('.flashcard')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Start practice' })).toBeDisabled();
});

test('pending cards are canceled when the script changes', async ({ page }) => {
  await prepare(page);
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/flashcards', async (route) => {
    await wait;
    await route.fulfill({ json: { points: talkingPoints } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'I’ve read my script once' }).click();
  await expect(page.getByText(/Finding your main talking points/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to script' }).click();
  await page.getByLabel('Your practice script').fill('A new script must never display old cards.');
  release();
  await page.getByRole('button', { name: 'Set up my recording' }).click();
  await expect(page.locator('.flashcard')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'I’ve read my script once' })).toBeVisible();
});
